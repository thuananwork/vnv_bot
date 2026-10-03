/**
 * Zalo Anchor Scanner (Bộ quét tin nhắn Zalo theo Mốc neo)
 * Giải pháp tìm kiếm chính xác qua ô Tìm kiếm trong cuộc trò chuyện (Search in Conversation)
 * Thay thế hoàn toàn cơ chế cuộn ngược mù (blind scroll up).
 */

const { zaloBrowserManager } = require('./zalo_browser_manager');
const { 
    isTaskMessage, 
    extractDateFromTaskMessage, 
    isBotSummaryReport, 
    extractDateFromReportMessage 
} = require('./message_parser');

class ZaloAnchorScanner {
    constructor() {
        this.browserManager = zaloBrowserManager;
        this.isCancelled = false;
        this.currentScanGroup = null;
        this.currentPage = null;
    }

    /**
     * Dừng ngay quá trình quét đang diễn ra và đóng tab Zalo đã mở để quét
     */
    async cancelScan() {
        console.log('[ANCHOR SCANNER] 🛑 Nhận yêu cầu dừng quét (Cancellation requested)!');
        this.isCancelled = true;

        if (this.currentPage) {
            try {
                if (!this.currentPage.isClosed()) {
                    console.log('[ANCHOR SCANNER] 🛑 Đang đóng tab Zalo đã mở để quét...');
                    await this.currentPage.close();
                }
            } catch (err) {
                console.warn('[ANCHOR SCANNER] Lỗi khi đóng tab Zalo hiện tại:', err.message);
            }
            this.currentPage = null;
        }

        // Đóng các tab zalo.me trong browserInstance nếu còn mở
        if (this.browserManager && this.browserManager.browserInstance && this.browserManager.browserInstance.isConnected()) {
            try {
                const openPages = await this.browserManager.browserInstance.pages();
                for (const p of openPages) {
                    if (p.url().includes('zalo.me')) {
                        console.log('[ANCHOR SCANNER] 🛑 Đang đóng tab Zalo qua browserInstance...');
                        await p.close().catch(() => {});
                    }
                }
            } catch (bErr) {
                console.warn('[ANCHOR SCANNER] Lỗi khi quét đóng các tab Zalo:', bErr.message);
            }
        }
    }

    /**
     * Mở ô Tìm kiếm trong cuộc trò chuyện (Search in conversation)
     * Click icon kính lúp trên header Zalo Web
     * @param {Object} page - Puppeteer Page
     * @returns {Promise<boolean>}
     */
    async openConversationSearch(page) {
        if (!page || page.isClosed()) return false;

        // 1. Kiểm tra nếu panel tìm kiếm đã mở sẵn
        const isAlreadyOpen = await page.evaluate(() => {
            const panel = document.querySelector('.search-message-panel-compact, .search-message-inchat, .search-message-panel, .search-message-input');
            return panel && panel.offsetParent !== null;
        });
        if (isAlreadyOpen) return true;

        // 2. Click nút tìm kiếm tin nhắn trên header
        try {
            const clicked = await page.evaluate(() => {
                const selectors = [
                    '.search-message-entry',
                    '[data-id="btn_search_message"]',
                    '#headerBtns [title*="Tìm kiếm"]',
                    '[title*="Tìm kiếm tin nhắn"]',
                    '#headerBtns .fa-outline-search',
                    '.fa-outline-search',
                    '[data-translate-title*="SEARCH"]',
                    '#headerBtns i[class*="search"]',
                    '#headerBtns [class*="search"]',
                    '.search-message-entry__icon'
                ];
                for (const s of selectors) {
                    const el = document.querySelector(s);
                    if (el && el.offsetParent !== null) {
                        const clickable = el.closest('button') || el.closest('.z--btn') || el.closest('[role="button"]') || el;
                        clickable.click();
                        return true;
                    }
                }
                return false;
            });

            await new Promise(r => setTimeout(r, 800));
            const opened = await page.evaluate(() => {
                const panel = document.querySelector('.search-message-panel-compact, .search-message-inchat, .search-message-panel, .search-message-input');
                return panel && panel.offsetParent !== null;
            });
            if (opened) return true;
        } catch (e) {}

        // 3. Dự phòng: Focus vào khung chat rồi ấn Ctrl + F
        try {
            await page.evaluate(() => {
                const chatRoot = document.querySelector('#chatViewContainer') || document.querySelector('#chat-box') || document.body;
                if (chatRoot) chatRoot.focus();
            });
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyF');
            await page.keyboard.up('Control');
            await new Promise(r => setTimeout(r, 800));
            const opened = await page.evaluate(() => {
                const panel = document.querySelector('.search-message-panel-compact, .search-message-inchat, .search-message-panel, .search-message-input');
                return panel && panel.offsetParent !== null;
            });
            return !!opened;
        } catch (e) {
            console.warn('[ANCHOR SCANNER] Không thể mở ô tìm kiếm bằng phím tắt:', e.message);
            return false;
        }
    }

    /**
     * Đóng ô Tìm kiếm trong cuộc trò chuyện
     * @param {Object} page 
     */
    async closeConversationSearch(page) {
        if (!page || page.isClosed()) return;
        try {
            await page.evaluate(() => {
                const closeBtn = document.querySelector('.search-message-inchat__header__right-btn, .search-message-inchat__header .fa-Close_24_Line, [data-translate-title="STR_CLOSE"], [title="Đóng"], .search-message-panel .close-btn');
                if (closeBtn) {
                    const clickable = closeBtn.closest('.z--btn--v2') || closeBtn.closest('button') || closeBtn;
                    clickable.click();
                }
            });
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {}
    }

    /**
     * Tìm và nhảy tới Báo cáo tổng hợp của ngày hôm trước (prevDate)
     * @param {Object} page 
     * @param {string} prevDate 'YYYY-MM-DD'
     * @returns {Promise<{found: boolean, date?: string}>}
     */
    async findAndJumpToReportAnchor(page, prevDate) {
        if (this.isCancelled) return { found: false, cancelled: true };
        console.log(`[ANCHOR SCANNER] 🔍 Đang tìm Báo cáo tổng hợp ngày hôm trước (${prevDate})...`);

        const parts = prevDate.split('-');
        const targetDay = parseInt(parts[2], 10);
        const targetMonth = parseInt(parts[1], 10);
        const dayPadded = String(targetDay).padStart(2, '0');
        const monthPadded = String(targetMonth).padStart(2, '0');

        try {
            const searchOpened = await this.openConversationSearch(page);
            if (!searchOpened) return { found: false };

            const performReportSearch = async (queryText) => {
                if (this.isCancelled) return { found: false, cancelled: true };

                await page.evaluate((term) => {
                    const input = document.querySelector('.search-message-input__editor, input[placeholder*="từ khóa"], input[data-translate-placeholder*="SEARCH"], .search-message-input input, input[placeholder*="Tìm kiếm"]');
                    if (input) {
                        input.focus();
                        input.select();
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                        document.execCommand('insertText', false, term);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, queryText);

                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 1600));

                return await page.evaluate((pDate) => {
                    function scoreReportMatch(txt) {
                        if (!txt) return -100;
                        const lower = txt.toLowerCase();
                        const isReport = (lower.includes('báo cáo ngày') || lower.includes('bao cao ngay') || lower.includes('báo cáo tiến độ') || lower.includes('bao cao tien do')) &&
                                         (lower.includes('vùng') || lower.includes('vung') || lower.includes('hàng ngày') || lower.includes('hang ngay'));
                        if (!isReport) return -100;

                        const [y, m, d] = pDate.split('-');
                        const dStr = String(parseInt(d, 10));
                        const dPad = String(parseInt(d, 10)).padStart(2, '0');
                        const mStr = String(parseInt(m, 10));
                        const mPad = String(parseInt(m, 10)).padStart(2, '0');

                        // CHỐNG NHẦM THÁNG: Nếu tin nhắn chỉ rõ ngày D với tháng KHÁC (vd 2/9 thay vì 2/10), loại bỏ ngay lập tức
                        const otherMonthRegex = new RegExp(`\\b(?:ngày\\s+)?0?${dStr}\\s*[/\\-]\\s*(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                        if (otherMonthRegex.test(lower)) return -100;
                        const otherMonthTextRegex = new RegExp(`\\b0?${dStr}\\s+tháng\\s+(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                        if (otherMonthTextRegex.test(lower)) return -100;

                        // Bắt buộc phải khớp CẢ NGÀY VÀ THÁNG mục tiêu (TUYỆT ĐỐI không chỉ so sánh riêng "ngày D")
                        const hasDate = lower.includes(`${dPad}/${mPad}`) || lower.includes(`${dStr}/${mStr}`) ||
                                        lower.includes(`${dPad}/${mStr}`) || lower.includes(`${dStr}/${mPad}`) ||
                                        lower.includes(`${dPad}-${mPad}`) || lower.includes(`${dStr}-${mStr}`) ||
                                        lower.includes(`${dStr} tháng ${mStr}`) || lower.includes(`${dPad} tháng ${mPad}`) ||
                                        lower.includes(`${dStr} thg ${mStr}`) || lower.includes(`${dPad} thg ${mPad}`) ||
                                        (new RegExp(`\\bngày\\s+0?${dStr}\\s*[/\\-]\\s*0?${mStr}\\b`, 'i').test(lower)) ||
                                        (new RegExp(`\\bngày\\s+0?${dStr}\\s+tháng\\s+0?${mStr}\\b`, 'i').test(lower));
                        if (!hasDate) return -100;
                        return 100;
                    }

                    const selectors = [
                        '.search-message__item',
                        '.search-message-item',
                        '.item-search-mess',
                        '[class*="search-message"] [class*="item"]',
                        '.search-message-panel [class*="item"]',
                        '.search-list-item',
                        'div[class*="search-item"]'
                    ];
                    const items = Array.from(document.querySelectorAll(selectors.join(', ')));
                    let bestItem = null;
                    let maxScore = -1;

                    for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        const text = it.textContent || '';
                        const sc = scoreReportMatch(text);
                        if (sc > maxScore) {
                            maxScore = sc;
                            bestItem = { node: it, text };
                        }
                    }

                    if (bestItem && maxScore > 0) {
                        bestItem.node.click();
                        return { found: true, text: bestItem.text.substring(0, 100), count: items.length, score: maxScore };
                    }
                    return { found: false, count: items.length };
                }, prevDate);
            };

            // Lần 1: Tìm "Báo cáo ngày DD/MM" (d/m)
            let res = await performReportSearch(`Báo cáo ngày ${targetDay}/${targetMonth}`);
            if (!res.found && !this.isCancelled) {
                // Lần 2: Tìm "Báo cáo ngày DD/MM" (dd/mm)
                res = await performReportSearch(`Báo cáo ngày ${dayPadded}/${monthPadded}`);
            }
            if (!res.found && !this.isCancelled) {
                // Lần 3: Tìm ngắn "Báo cáo DD/MM"
                res = await performReportSearch(`Báo cáo ${dayPadded}/${monthPadded}`);
            }
            if (!res.found && !this.isCancelled) {
                // Lần 4: Tìm "BÁO CÁO HÀNG NGÀY" (kèm đối soát nghiêm ngặt ngày/tháng trong scoreReportMatch)
                res = await performReportSearch(`Báo cáo hàng ngày`);
            }

            if (res.found) {
                console.log(`[ANCHOR SCANNER] 🎯 [TÌM KIẾM ZALO] Đã tìm thấy Báo cáo tổng hợp ngày ${prevDate} và nhảy thẳng tới mốc!`);
                await new Promise(r => setTimeout(r, 1200));
                await this.closeConversationSearch(page);
                await new Promise(r => setTimeout(r, 600));
                return { found: true, date: prevDate };
            } else {
                console.log(`[ANCHOR SCANNER] ℹ️ Không tìm thấy Báo cáo ngày ${prevDate} qua ô tìm kiếm.`);
                await this.closeConversationSearch(page);
                return { found: false };
            }
        } catch (err) {
            console.warn('[ANCHOR SCANNER] Lỗi khi tìm báo cáo ngày hôm trước:', err.message);
            await this.closeConversationSearch(page);
            return { found: false };
        }
    }

    /**
     * Xác định mốc neo bắt đầu thông minh:
     * 1. Ưu tiên: Nhảy tới Báo cáo tổng hợp ngày hôm trước (prevDate) nếu có
     * 2. Fallback (ngày đầu chạy bot, hoặc khoảng thời gian dài mới chạy lại): Nhảy tới Nhiệm vụ của chính ngày đó (workDate)
     * @param {Object} page 
     * @param {string} workDate 'YYYY-MM-DD'
     * @param {Object} [options] 
     * @returns {Promise<{found: boolean, date: string|null, anchorType?: string, error?: string}>}
     */
    async findAndJumpToStartAnchor(page, workDate, options = {}) {
        if (this.isCancelled) return { found: false, cancelled: true };

        // Tính ngày hôm trước (prevDate)
        const parts = workDate.split('-');
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        dt.setDate(dt.getDate() - 1);
        const prevYear = dt.getFullYear();
        const prevMonth = String(dt.getMonth() + 1).padStart(2, '0');
        const prevDay = String(dt.getDate()).padStart(2, '0');
        const prevDate = `${prevYear}-${prevMonth}-${prevDay}`;

        console.log(`[ANCHOR SCANNER] 🧭 Bắt đầu xác định mốc neo cho ngày ${workDate}...`);

        // 1. ƯU TIÊN SỐ 1: Tìm mốc Nhiệm Vụ chuẩn của chính ngày cần quét (workDate)
        // Mẫu chuẩn: KẾ HOẠCH LÀM VIỆC SỨ GIẢ ngày DD/MM/YYYY
        console.log(`[ANCHOR SCANNER] 🔍 [Ưu tiên 1] Tìm tin nhắn Nhiệm vụ ngày ${workDate} (KẾ HOẠCH LÀM VIỆC SỨ GIẢ)...`);
        const taskAnchor = await this.findAndJumpToTaskAnchor(page, workDate, options);
        if (taskAnchor && taskAnchor.found) {
            console.log(`[ANCHOR SCANNER] 🎯 Đã tìm thấy và nhảy tới Nhiệm vụ ngày ${workDate}. Sẽ quét xuôi dòng từ mốc này!`);
            return {
                found: true,
                date: workDate,
                anchorType: 'TASK_ANCHOR'
            };
        }

        if (this.isCancelled) return { found: false, cancelled: true };

        // 2. DỰ PHÒNG (Fallback): Chỉ khi ngày này không có tin nhắn Nhiệm Vụ mẫu, mới tìm Báo cáo hôm trước
        console.log(`[ANCHOR SCANNER] ℹ️ [Dự phòng 2] Không thấy nhiệm vụ ngày ${workDate}. Thử tìm Báo cáo tổng hợp ngày hôm trước (${prevDate})...`);
        const reportAnchor = await this.findAndJumpToReportAnchor(page, prevDate);
        if (reportAnchor && reportAnchor.found) {
            console.log(`[ANCHOR SCANNER] 🎯 Đã nhảy tới Báo cáo ngày hôm trước (${prevDate}). Sẽ quét xuôi dòng từ mốc này!`);
            return {
                found: true,
                date: prevDate,
                anchorType: 'PREV_DAY_REPORT'
            };
        }

        return taskAnchor;
    }

    /**
     * Nhập từ khóa tìm kiếm và tìm kết quả mốc neo Nhiệm vụ
     * Dùng ô Tìm kiếm trong cuộc trò chuyện (In-Chat Search) và nhảy thẳng tới tin nhắn.
     * TUYỆT ĐỐI KHÔNG DÙNG CUỘN NGƯỢC MÙ (Blind Scroll Up).
     * @param {Object} page 
     * @param {string} workDate 'YYYY-MM-DD'
     * @param {Object} [options]
     * @returns {Promise<{found: boolean, date: string|null, error?: string}>}
     */
    async findAndJumpToTaskAnchor(page, workDate, options = {}) {
        if (this.isCancelled) return { found: false, cancelled: true };
        console.log(`[ANCHOR SCANNER] 🔍 Bắt đầu tìm kiếm mốc neo Nhiệm vụ cho ngày ${workDate}...`);

        // Helper hàm trích xuất ngày và kiểm tra format nhiệm vụ (có đối soát Thứ trong tuần)
        const checkAnchorInDOM = async (targetDate) => {
            return await page.evaluate((tDate) => {
                const msgs = Array.from(document.querySelectorAll('.chat-item, .msg-item, [class*="chat-item"], [class*="msg-item"], .message-view'));
                
                function scoreTaskMatch(txt) {
                    if (!txt) return -100;
                    const lower = txt.toLowerCase();
                    const isTaskPlan = (lower.includes('kế hoạch làm việc') || lower.includes('ke hoach lam viec')) &&
                                       (lower.includes('sứ giả') || lower.includes('su gia') || lower.includes('hàng ngày') || lower.includes('hang ngay') || lower.includes('nhiệm vụ'));
                    if (!isTaskPlan) return -100;

                    const parts = tDate.split('-');
                    const y = parseInt(parts[0], 10);
                    const m = parseInt(parts[1], 10);
                    const d = parseInt(parts[2], 10);
                    const dt = new Date(y, m - 1, d);
                    const dow = dt.getDay(); // 0: CN, 1: T2, 2: T3, 3: T4, 4: T5, 5: T6, 6: T7

                    const dowKeywords = {
                        0: ['chủ nhật', 'chu nhat', 'cn'],
                        1: ['thứ 2', 'thu 2', 'thứ hai', 'thu hai', 't2'],
                        2: ['thứ 3', 'thu 3', 'thứ ba', 'thu ba', 't3'],
                        3: ['thứ 4', 'thu 4', 'thứ tư', 'thu tu', 't4'],
                        4: ['thứ 5', 'thu 5', 'thứ năm', 'thu nam', 't5'],
                        5: ['thứ 6', 'thu 6', 'thứ sáu', 'thu sau', 't6'],
                        6: ['thứ 7', 'thu 7', 'thứ bảy', 'thu bay', 't7']
                    };

                    const validDow = dowKeywords[dow] || [];
                    const otherDows = [];
                    for (let i = 0; i < 7; i++) {
                        if (i !== dow) otherDows.push(...(dowKeywords[i] || []));
                    }

                    const dStr = String(d);
                    const dPad = String(d).padStart(2, '0');
                    const mStr = String(m);
                    const mPad = String(m).padStart(2, '0');

                    // CHỐNG NHẦM THÁNG: Nếu bài nhiệm vụ chỉ rõ ngày D với tháng KHÁC (vd 2/9, 2 tháng 9 thay vì 2/10), loại bỏ ngay lập tức
                    const otherMonthRegex = new RegExp(`\\b(?:ngày\\s+)?0?${dStr}\\s*[/\\-]\\s*(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                    if (otherMonthRegex.test(lower)) return -100;
                    const otherMonthTextRegex = new RegExp(`\\b0?${dStr}\\s+tháng\\s+(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                    if (otherMonthTextRegex.test(lower)) return -100;

                    // Bắt buộc phải khớp CẢ NGÀY VÀ THÁNG mục tiêu (TUYỆT ĐỐI không chỉ so sánh riêng "ngày D")
                    const hasExactDate = lower.includes(`${dPad}/${mPad}`) || lower.includes(`${dStr}/${mStr}`) ||
                                         lower.includes(`${dPad}/${mStr}`) || lower.includes(`${dStr}/${mPad}`) ||
                                         lower.includes(`${dPad}-${mPad}`) || lower.includes(`${dStr}-${mStr}`) ||
                                         lower.includes(`${dStr} tháng ${mStr}`) || lower.includes(`${dPad} tháng ${mPad}`) ||
                                         lower.includes(`${dStr} thg ${mStr}`) || lower.includes(`${dPad} thg ${mPad}`) ||
                                         (new RegExp(`\\bngày\\s+0?${dStr}\\s*[/\\-]\\s*0?${mStr}\\b`, 'i').test(lower)) ||
                                         (new RegExp(`\\bngày\\s+0?${dStr}\\s+tháng\\s+0?${mStr}\\b`, 'i').test(lower));
                    if (!hasExactDate) return -100;

                    let score = 40;

                    const hasTargetDow = validDow.some(w => {
                        const regex = new RegExp(`(^|[^a-z0-9à-ỹ])${w}([^a-z0-9à-ỹ]|$)`, 'i');
                        return regex.test(lower);
                    });
                    const hasOtherDow = otherDows.some(w => {
                        const regex = new RegExp(`(^|[^a-z0-9à-ỹ])${w}([^a-z0-9à-ỹ]|$)`, 'i');
                        return regex.test(lower);
                    });

                    if (hasTargetDow) {
                        score += 50;
                    } else if (hasOtherDow) {
                        return -100; // Khác thứ => loại bỏ ngay (gõ nhầm ngày)
                    }

                    if (lower.includes('👉') || lower.includes('nhiệm vụ hôm nay') || lower.includes('nhan su') || lower.includes('sứ giả')) {
                        score += 20;
                    }
                    return score;
                }

                let bestMsg = null;
                let maxScore = -1;

                for (const m of msgs) {
                    const txt = (m.textContent || '').trim();
                    const sc = scoreTaskMatch(txt);
                    if (sc > maxScore) {
                        maxScore = sc;
                        bestMsg = { node: m, text: txt };
                    }
                }

                if (bestMsg && maxScore > 0) {
                    bestMsg.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return { found: true, date: tDate, text: bestMsg.text.substring(0, 120), score: maxScore };
                }
                return { found: false, count: msgs.length };
            }, targetDate);
        };

        // 1. Kiểm tra nhanh xem mốc neo có đang hiển thị sẵn trên màn hình không
        let check = await checkAnchorInDOM(workDate);
        if (check.found) {
            console.log(`[ANCHOR SCANNER] 🎯 Tìm thấy Nhiệm vụ ngày ${check.date} hiển thị sẵn trong khung chat (Điểm: ${check.score}).`);
            return { found: true, date: check.date };
        }

        if (this.isCancelled) return { found: false, cancelled: true };

        // 2. PHƯƠNG PHÁP CHÍNH: Tìm kiếm bằng ô Tìm kiếm trong cuộc trò chuyện (In-Chat Search)
        console.log(`[ANCHOR SCANNER] 🔎 Đang dùng ô Tìm kiếm trong trò chuyện để tìm nhiệm vụ ngày ${workDate}...`);
        try {
            const searchOpened = await this.openConversationSearch(page);
            if (searchOpened) {
                const parts = workDate.split('-');
                const targetDay = parseInt(parts[2], 10);
                const targetMonth = parseInt(parts[1], 10);
                const dayPadded = String(targetDay).padStart(2, '0');
                const monthPadded = String(targetMonth).padStart(2, '0');

                // Helper tìm kiếm và duyệt kết quả trong panel
                const performSearchQuery = async (queryText) => {
                    if (this.isCancelled) return { found: false, cancelled: true };

                    await page.evaluate((term) => {
                        const input = document.querySelector('.search-message-input__editor, input[placeholder*="từ khóa"], input[data-translate-placeholder*="SEARCH"], .search-message-input input, input[placeholder*="Tìm kiếm"]');
                        if (input) {
                            input.focus();
                            input.select();
                            document.execCommand('selectAll', false, null);
                            document.execCommand('delete', false, null);
                            document.execCommand('insertText', false, term);
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, queryText);

                    await page.keyboard.press('Enter');
                    await new Promise(r => setTimeout(r, 1600));

                    return await page.evaluate((tDate) => {
                        function scoreTaskMatch(txt) {
                            if (!txt) return -100;
                            const lower = txt.toLowerCase();
                            const isTaskPlan = (lower.includes('kế hoạch làm việc') || lower.includes('ke hoach lam viec')) &&
                                               (lower.includes('sứ giả') || lower.includes('su gia') || lower.includes('hàng ngày') || lower.includes('hang ngay') || lower.includes('nhiệm vụ'));
                            if (!isTaskPlan) return -100;

                            const parts = tDate.split('-');
                            const y = parseInt(parts[0], 10);
                            const m = parseInt(parts[1], 10);
                            const d = parseInt(parts[2], 10);
                            const dt = new Date(y, m - 1, d);
                            const dow = dt.getDay(); // 0: CN, 1: T2, 2: T3, 3: T4, 4: T5, 5: T6, 6: T7

                            const dowKeywords = {
                                0: ['chủ nhật', 'chu nhat', 'cn'],
                                1: ['thứ 2', 'thu 2', 'thứ hai', 'thu hai', 't2'],
                                2: ['thứ 3', 'thu 3', 'thứ ba', 'thu ba', 't3'],
                                3: ['thứ 4', 'thu 4', 'thứ tư', 'thu tu', 't4'],
                                4: ['thứ 5', 'thu 5', 'thứ năm', 'thu nam', 't5'],
                                5: ['thứ 6', 'thu 6', 'thứ sáu', 'thu sau', 't6'],
                                6: ['thứ 7', 'thu 7', 'thứ bảy', 'thu bay', 't7']
                            };

                            const validDow = dowKeywords[dow] || [];
                            const otherDows = [];
                            for (let i = 0; i < 7; i++) {
                                if (i !== dow) otherDows.push(...(dowKeywords[i] || []));
                            }

                            const dStr = String(d);
                            const dPad = String(d).padStart(2, '0');
                            const mStr = String(m);
                            const mPad = String(m).padStart(2, '0');

                            // CHỐNG NHẦM THÁNG: Nếu bài nhiệm vụ chỉ rõ ngày D với tháng KHÁC (vd 2/9, 2 tháng 9 thay vì 2/10), loại bỏ ngay lập tức
                            const otherMonthRegex = new RegExp(`\\b(?:ngày\\s+)?0?${dStr}\\s*[/\\-]\\s*(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                            if (otherMonthRegex.test(lower)) return -100;
                            const otherMonthTextRegex = new RegExp(`\\b0?${dStr}\\s+tháng\\s+(?!0?${mStr}\\b)(\\d{1,2})`, 'i');
                            if (otherMonthTextRegex.test(lower)) return -100;

                            // Bắt buộc phải khớp CẢ NGÀY VÀ THÁNG mục tiêu (TUYỆT ĐỐI không chỉ so sánh riêng "ngày D")
                            const hasExactDate = lower.includes(`${dPad}/${mPad}`) || lower.includes(`${dStr}/${mStr}`) ||
                                                 lower.includes(`${dPad}/${mStr}`) || lower.includes(`${dStr}/${mPad}`) ||
                                                 lower.includes(`${dPad}-${mPad}`) || lower.includes(`${dStr}-${mStr}`) ||
                                                 lower.includes(`${dStr} tháng ${mStr}`) || lower.includes(`${dPad} tháng ${mPad}`) ||
                                                 lower.includes(`${dStr} thg ${mStr}`) || lower.includes(`${dPad} thg ${mPad}`) ||
                                                 (new RegExp(`\\bngày\\s+0?${dStr}\\s*[/\\-]\\s*0?${mStr}\\b`, 'i').test(lower)) ||
                                                 (new RegExp(`\\bngày\\s+0?${dStr}\\s+tháng\\s+0?${mStr}\\b`, 'i').test(lower));
                            if (!hasExactDate) return -100;

                            let score = 40;

                            const hasTargetDow = validDow.some(w => {
                                const regex = new RegExp(`(^|[^a-z0-9à-ỹ])${w}([^a-z0-9à-ỹ]|$)`, 'i');
                                return regex.test(lower);
                            });
                            const hasOtherDow = otherDows.some(w => {
                                const regex = new RegExp(`(^|[^a-z0-9à-ỹ])${w}([^a-z0-9à-ỹ]|$)`, 'i');
                                return regex.test(lower);
                            });

                            if (hasTargetDow) {
                                score += 50;
                            } else if (hasOtherDow) {
                                return -100; // Khác thứ => loại bỏ ngay (gõ nhầm ngày)
                            }

                            if (lower.includes('👉') || lower.includes('nhiệm vụ hôm nay') || lower.includes('nhan su') || lower.includes('sứ giả')) {
                                score += 20;
                            }
                            return score;
                        }

                        const selectors = [
                            '.search-message__item',
                            '.search-message-item',
                            '.item-search-mess',
                            '[class*="search-message"] [class*="item"]',
                            '.search-message-panel [class*="item"]',
                            '.search-list-item',
                            'div[class*="search-item"]'
                        ];
                        const items = Array.from(document.querySelectorAll(selectors.join(', ')));
                        let bestItem = null;
                        let maxScore = -1;

                        for (let i = 0; i < items.length; i++) {
                            const it = items[i];
                            const text = it.textContent || '';
                            const sc = scoreTaskMatch(text);
                            if (sc > maxScore) {
                                maxScore = sc;
                                bestItem = { node: it, text };
                            }
                        }

                        if (bestItem && maxScore > 0) {
                            bestItem.node.click();
                            return { found: true, text: bestItem.text.substring(0, 100), count: items.length, score: maxScore };
                        }
                        return { found: false, count: items.length };
                    }, workDate);
                };

                // Lần tìm kiếm 1: "ngày DD/MM" (tìm đích danh ngày và tháng hiện tại)
                console.log(`[ANCHOR SCANNER] ⌨️ Tìm kiếm từ khóa: "ngày ${targetDay}/${targetMonth}"...`);
                let searchResult = await performSearchQuery(`ngày ${targetDay}/${targetMonth}`);

                // Lần tìm kiếm 2: Tìm "ngày DD/MM" với số 0 đệm
                if (!searchResult.found && !this.isCancelled) {
                    console.log(`[ANCHOR SCANNER] ℹ️ Thử tìm kiếm theo ngày: "ngày ${dayPadded}/${monthPadded}"...`);
                    searchResult = await performSearchQuery(`ngày ${dayPadded}/${monthPadded}`);
                }

                // Lần tìm kiếm 3: Tìm "KẾ HOẠCH LÀM VIỆC"
                if (!searchResult.found && !this.isCancelled) {
                    console.log(`[ANCHOR SCANNER] ℹ️ Thử tìm kiếm từ khóa chung: "KẾ HOẠCH LÀM VIỆC SỨ GIẢ"...`);
                    searchResult = await performSearchQuery('KẾ HOẠCH LÀM VIỆC SỨ GIẢ');
                }

                // Lần tìm kiếm 4: Tìm "KẾ HOẠCH LÀM VIỆC" ngắn
                if (!searchResult.found && !this.isCancelled) {
                    console.log(`[ANCHOR SCANNER] ℹ️ Thử tìm kiếm từ khóa: "KẾ HOẠCH LÀM VIỆC"...`);
                    searchResult = await performSearchQuery('KẾ HOẠCH LÀM VIỆC');
                }

                if (searchResult.found) {
                    console.log(`[ANCHOR SCANNER] 🎯 [TÌM KIẾM ZALO] Đã tìm thấy mốc Nhiệm vụ ngày ${workDate} qua ô tìm kiếm và nhảy thẳng tới tin nhắn!`);
                    await new Promise(r => setTimeout(r, 1200));
                    await this.closeConversationSearch(page);
                    await new Promise(r => setTimeout(r, 600));
                    await checkAnchorInDOM(workDate);
                    return { found: true, date: workDate, method: 'IN_CHAT_SEARCH' };
                } else {
                    console.log(`[ANCHOR SCANNER] ℹ️ Ô tìm kiếm Zalo không có kết quả nhiệm vụ khớp với ngày ${workDate} (${searchResult.count} kết quả khác).`);
                    await this.closeConversationSearch(page);
                }
            }
        } catch (searchErr) {
            console.warn('[ANCHOR SCANNER] Lỗi khi dùng ô tìm kiếm trong trò chuyện:', searchErr.message);
            await this.closeConversationSearch(page);
        }

        // Kiểm tra lại DOM một lần nữa sau khi đã đóng tìm kiếm
        check = await checkAnchorInDOM(workDate);
        if (check.found) {
            return { found: true, date: check.date };
        }

        return { 
            found: false, 
            date: null, 
            error: `Không tìm thấy tin nhắn nhiệm vụ cho ngày ${workDate} trong nhóm qua tìm kiếm Zalo.` 
        };
    }

    /**
     * Cuộn XUỐNG từ vị trí mốc neo để thu thập tin nhắn nộp bài của Sứ giả
     * - Nếu quét ngày HÔM NAY: Cuộn xuôi dòng cho đến CUỐI NGÀY (tin nhắn mới nhất).
     * - Nếu quét NGÀY CŨ: Cuộn xuôi dòng cho đến khi gặp NHIỆM VỤ CỦA NGÀY SAU ĐÓ 1 NGÀY (nextDate).
     * @param {Object} page 
     * @param {string} workDate 'YYYY-MM-DD'
     * @param {Object} options 
     * @returns {Promise<Array<Object>>}
     */
    async collectMessagesDownward(page, workDate, options = {}) {
        const MAX_PASSES = options.maxScrollPasses || 60;
        const todayStr = new Date().toLocaleDateString('sv');
        const isToday = (workDate >= todayStr);

        // Tính ngày tiếp theo: nextDate = workDate + 1 ngày
        const parts = workDate.split('-');
        const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        dt.setDate(dt.getDate() + 1);
        const nextYear = dt.getFullYear();
        const nextMonth = String(dt.getMonth() + 1).padStart(2, '0');
        const nextDay = String(dt.getDate()).padStart(2, '0');
        const nextDate = `${nextYear}-${nextMonth}-${nextDay}`;

        const anchorType = options.anchorType || 'TASK_ANCHOR';

        console.log(`[ANCHOR SCANNER] ⬇️ Bắt đầu cuộn XUỐNG thu thập báo cáo sứ giả:`);
        console.log(`                 - Ngày quét: ${workDate} (${isToday ? 'HÔM NAY - Cuộn đến cuối ngày' : 'NGÀY CŨ - Dừng khi gặp nhiệm vụ ngày ' + nextDate})`);
        console.log(`                 - Mốc neo bắt đầu: ${anchorType}`);

        const messagesMap = new Map();
        let hitStopAnchor = false;
        let stopReason = '';
        let consecutiveNoNew = 0;

        for (let pass = 0; pass < MAX_PASSES; pass++) {
            if (this.isCancelled || !page || page.isClosed()) {
                console.log('[ANCHOR SCANNER] 🛑 Dừng cuộn xuống do nhận yêu cầu hủy từ người dùng hoặc tab đã đóng.');
                break;
            }
            let batch;
            try {
                batch = await page.evaluate((args) => {
                const { workDate, isToday, nextDate, anchorType } = args;
                const list = [];
                const chatRoot = document.querySelector('#chatViewContainer') || document.querySelector('[id*="chatView"]') || document.body;

                function extractDate(txt) {
                    if (!txt) return null;
                    const regex1 = /ngày\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/i;
                    const match1 = regex1.exec(txt);
                    if (match1) {
                        const d = match1[1].padStart(2, '0');
                        const m = match1[2].padStart(2, '0');
                        let y = match1[3] ? parseInt(match1[3], 10) : new Date().getFullYear();
                        if (y < 100) y += 2000;
                        return `${y}-${m}-${d}`;
                    }
                    const regex2 = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;
                    const match2 = regex2.exec(txt);
                    if (match2) {
                        const d = match2[1].padStart(2, '0');
                        const m = match2[2].padStart(2, '0');
                        let y = match2[3] ? parseInt(match2[3], 10) : new Date().getFullYear();
                        if (y < 100) y += 2000;
                        return `${y}-${m}-${d}`;
                    }
                    return null;
                }

                // Dừng khi gặp Nhiệm vụ của ngày sau ngày cần quét (nextDate)
                // CHỈ áp dụng cho các ngày cũ (!isToday).
                // Nếu là ngày hôm nay (isToday), KHÔNG dừng ở bất kỳ nhiệm vụ nào mà cuộn đến cuối ngày (tin nhắn mới nhất).
                function isStopTask(txt) {
                    if (isToday) return false;
                    if (!txt) return false;
                    const lower = txt.toLowerCase();
                    const isTask = (lower.includes('kế hoạch làm việc') || lower.includes('ke hoach lam viec') || lower.includes('kế hoạch công việc') || lower.includes('nhiệm vụ ngày')) &&
                                  (lower.includes('hàng ngày') || lower.includes('hang ngay') || lower.includes('nhiệm vụ') || lower.includes('sứ giả') || lower.includes('ngày '));
                    if (!isTask) return false;
                    const d = extractDate(txt);
                    return d && d >= nextDate;
                }

                function isSummaryReport(txt) {
                    if (!txt) return false;
                    const lower = txt.toLowerCase();
                    const isModel1 = (lower.includes('báo cáo ngày') || lower.includes('bao cao ngay')) &&
                                     (lower.includes('hàng ngày') || lower.includes('hang ngay')) &&
                                     (lower.includes('vùng') || lower.includes('vung'));
                    const isModel2 = lower.includes('báo cáo tiến độ vùng') || lower.includes('bao cao tien do vung');
                    return isModel1 || isModel2;
                }

                let stopDetected = false;
                let stopType = '';

                const msgNodes = chatRoot.querySelectorAll('.chat-item, .msg-item, [class*="chat-item"], [class*="msg-item"], .message-view, .chat-message');
                let currentSender = '';

                msgNodes.forEach(node => {
                    if (stopDetected) return;

                    let rawSender = '';
                    const innerSender = node.querySelector('.sender-name, .message-sender-name-content');
                    if (innerSender) {
                        rawSender = (innerSender.textContent || '').trim();
                    } else {
                        const containerSender = node.querySelector('.card-sender-name, .message-sender-name-bubble');
                        if (containerSender) {
                            const clone = containerSender.cloneNode(true);
                            clone.querySelectorAll('.rel-name, .sub-name, [class*="rel-name"]').forEach(el => el.remove());
                            rawSender = (clone.textContent || '').trim();
                        } else {
                            const relEl = node.querySelector('div.rel-name');
                            if (relEl) rawSender = (relEl.textContent || '').trim();
                        }
                    }

                    if (rawSender) {
                        let cleanSender = rawSender.replace(/\/-[a-z0-9\:\(\)]+/gi, '').replace(/\s+/g, ' ').trim();
                        const vnUpper = 'A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ';
                        const vnLower = 'a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ';
                        const match = cleanSender.match(new RegExp('^(.+?[' + vnLower + '0-9])([' + vnUpper + '][' + vnLower + ']+(?:\\s+[' + vnUpper + '][' + vnLower + ']+){1,3})$'));
                        if (match && match[1].trim().length >= 2 && match[2].trim().length >= 4) {
                            cleanSender = match[1].trim();
                        }

                        if (cleanSender && cleanSender.length <= 35 && !cleanSender.includes('\n') && !cleanSender.toLowerCase().includes('báo cáo')) {
                            currentSender = cleanSender;
                        }
                    }

                    const textEl = node.querySelector('.message-text, [class*="content-text"], .bubble-text, span.text, .text-quote');
                    const imgs = Array.from(node.querySelectorAll('img.zimg-el, img.img-msg, [class*="photo"] img, [class*="zimg"], img[src^="blob:"]'));
                    const hasImage = imgs.some(img => {
                        const cls = img.className || '';
                        const src = img.src || '';
                        if (cls.includes('react') || cls.includes('avatar') || cls.includes('emoji')) return false;
                        if (src.includes('iconlike') || src.includes('upload/media/')) return false;
                        return true;
                    });
                    const timeEl = node.querySelector('.time, .message-time, [class*="time"], [class*="msg-time"]');
                    const timeText = timeEl ? timeEl.textContent.trim() : '';

                    const text = textEl ? textEl.textContent.trim() : (hasImage ? '[Ảnh]' : '');

                    // Dừng khi gặp Nhiệm vụ của ngày sau ngày cần quét (chỉ khi quét ngày cũ)
                    if (isStopTask(text)) {
                        stopDetected = true;
                        stopType = 'NEXT_DAY_TASK';
                        return;
                    }

                    // Không thu thập tin nhắn Báo cáo tổng hợp hoặc Nhiệm vụ làm bài nộp
                    if (isSummaryReport(text)) {
                        return;
                    }
                    const lower = text.toLowerCase();
                    if ((lower.includes('kế hoạch làm việc') || lower.includes('ke hoach lam viec')) &&
                        (lower.includes('hàng ngày') || lower.includes('hang ngay'))) {
                        return;
                    }
                    // Không thu thập tin nhắn giao nhiệm vụ / thông báo đầu ngày làm bài nộp
                    if (lower.includes('mình gửi nhiệm vụ') || lower.includes('gửi nhiệm vụ hôm nay') ||
                        lower.includes('minh gui nhiem vu') || lower.includes('gui nhiem vu hom nay') ||
                        lower.includes('nhiệm vụ hôm nay nhá') || lower.includes('nhiệm vụ hôm nay nhé') ||
                        lower.includes('nv hôm nay nhá') || lower.includes('nv hôm nay nhé') ||
                        lower.includes('kế hoạch làm việc') || lower.includes('ke hoach lam viec')) {
                        return;
                    }

                    if (text || hasImage) {
                        const rawId = node.getAttribute('data-id') || node.getAttribute('data-mid') || node.id || '';
                        const key = rawId ? rawId : `${currentSender}::${timeText}::${text.substring(0, 40)}`;
                        list.push({
                            uniqueKey: key,
                            sender: currentSender || 'Unknown',
                            text,
                            hasImage,
                            timeText,
                            timestamp: Date.now()
                        });
                    }
                });

                // Tìm container cuộn và cuộn XUỐNG (Scroll Down)
                let container = null;
                const divs = Array.from(chatRoot.querySelectorAll('div'));
                for (const d of divs) {
                    const s = window.getComputedStyle(d);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight && d.clientHeight > 150) {
                        container = d;
                        break;
                    }
                }

                let atBottom = false;
                if (container) {
                    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + 800);
                    container.dispatchEvent(new Event('scroll', { bubbles: true }));
                    atBottom = (container.scrollTop + container.clientHeight) >= (container.scrollHeight - 30);
                }

                return {
                    messages: list,
                    stopDetected,
                    stopType,
                    atBottom
                };
            }, { workDate, isToday, nextDate, anchorType });
            } catch (evalErr) {
                if (this.isCancelled || !page || page.isClosed()) {
                    console.log('[ANCHOR SCANNER] 🛑 Tab Zalo đã đóng trong lúc dừng quét.');
                    break;
                }
                console.warn('[ANCHOR SCANNER] Lỗi evaluate cuộn trang:', evalErr.message);
                break;
            }

            if (!batch || !batch.messages) break;

            let newMessagesCount = 0;
            for (const m of batch.messages) {
                if (!messagesMap.has(m.uniqueKey)) {
                    messagesMap.set(m.uniqueKey, m);
                    newMessagesCount++;
                }
            }

            if (newMessagesCount === 0) {
                consecutiveNoNew++;
            } else {
                consecutiveNoNew = 0;
            }

            if (batch.stopDetected) {
                hitStopAnchor = true;
                stopReason = `Gặp nhiệm vụ ngày tiếp theo (${nextDate})`;
                console.log(`[ANCHOR SCANNER] 🛑 Đã gặp mốc dừng: ${stopReason}. Kết thúc quét.`);
                break;
            }

            // CHỈ dừng khi chạm đáy (atBottom) VÀ ít nhất 3 lần cuộn liên tiếp không có thêm tin nhắn mới
            if (batch.atBottom && consecutiveNoNew >= 3) {
                console.log('[ANCHOR SCANNER] 🏁 Đã cuộn đến cuối cuộc trò chuyện (tin nhắn mới nhất).');
                break;
            }

            // Phòng hộ nếu đứng yên 10 lần liên tiếp dù chưa ở đáy (hỗ trợ máy cấu hình thấp/mạng chậm)
            if (consecutiveNoNew >= 10) {
                console.log('[ANCHOR SCANNER] 🏁 Đã dừng vì 10 lần cuộn liên tiếp không có thêm tin nhắn mới.');
                break;
            }

            // Kích hoạt virtual wheel scroll xuống dưới & DOM scroll trực tiếp
            try {
                const chatBox = await page.evaluate(() => {
                    const cr = document.querySelector('#chatViewContainer') || document.body;
                    const r = cr.getBoundingClientRect();

                    // Đồng thời cuộn trực tiếp trên các container cuộn của Zalo Web
                    const scrollers = [
                        document.querySelector('#messageViewScroll'),
                        document.querySelector('.virtualized-scroll'),
                        document.querySelector('.chat-message-list'),
                        cr
                    ];
                    for (const s of scrollers) {
                        if (s && s.scrollHeight > s.clientHeight) {
                            s.scrollTop += 800;
                        }
                    }

                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                });
                await page.mouse.move(chatBox.x, chatBox.y);
                await page.mouse.wheel({ deltaY: 800 });

                if (consecutiveNoNew >= 2) {
                    await page.keyboard.press('PageDown');
                }
            } catch (wErr) {}

            // Chờ Zalo tải tin nhắn mới (chờ 1000ms nếu đang ở mép đáy buffer hoặc đang chờ tải tiếp)
            await new Promise(r => setTimeout(r, (batch.atBottom || consecutiveNoNew > 0) ? 1000 : 700));
        }

        const resultList = Array.from(messagesMap.values());
        console.log(`[ANCHOR SCANNER] ✅ Đã thu thập ${resultList.length} tin nhắn hợp lệ sau mốc neo.`);
        return resultList;
    }

    /**
     * Phương thức chính: Quét theo Mốc Neo (Anchor-Based Scanning)
     * @param {string} groupName 
     * @param {string} workDate 'YYYY-MM-DD'
     * @param {Object} [options]
     */
    async scanWithAnchors(groupName, workDate, options = {}) {
        this.isCancelled = false;
        this.currentScanGroup = groupName;
        const autoOpen = options.autoOpen !== false;
        const showBrowser = options.showBrowser === true;
        const targetDate = workDate || new Date().toLocaleDateString('sv');

        console.log(`[ANCHOR SCANNER] 🚀 Khởi chạy Quét theo Mốc Neo cho nhóm "${groupName}", ngày ${targetDate}...`);

        if (this.isCancelled) {
            return { connected: true, cancelled: true, messagesScraped: 0, scrapedEvents: [], groupName, workDate: targetDate, reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.' };
        }

        // 1. Kiểm tra / Khởi động trình duyệt
        let isBrowserAlive = false;
        if (this.browserManager.browserInstance && this.browserManager.browserInstance.isConnected()) {
            try {
                const testPages = await this.browserManager.browserInstance.pages();
                if (testPages && testPages.length > 0) {
                    isBrowserAlive = true;
                }
            } catch (e) {
                isBrowserAlive = false;
                this.browserManager.browserInstance = null;
            }
        }

        if (!isBrowserAlive) {
            if (!autoOpen) {
                return { connected: false, messagesScraped: 0, reason: 'Trình duyệt Zalo chưa được mở.' };
            }
            try {
                await this.browserManager.openLoginWindow();
            } catch (e) {
                return { connected: false, messagesScraped: 0, reason: 'Không thể mở Zalo: ' + e.message };
            }
        }

        if (this.isCancelled) {
            return { connected: true, cancelled: true, messagesScraped: 0, scrapedEvents: [], groupName, workDate: targetDate, reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.' };
        }

        let pages;
        try {
            pages = await this.browserManager.browserInstance.pages();
        } catch (e) {
            return { connected: false, messagesScraped: 0, reason: 'Không thể kết nối cửa sổ Zalo: ' + e.message };
        }
        if (!pages || pages.length === 0) {
            return { connected: false, messagesScraped: 0, reason: 'Không tìm thấy tab Zalo Web.' };
        }
        
        let page = pages.find(p => p.url().includes('zalo.me'));
        if (!page) {
            page = pages[0];
            if (!page.url().includes('zalo.me')) {
                await page.goto('https://chat.zalo.me', { waitUntil: 'domcontentloaded' });
            }
        }
        this.currentPage = page;
        for (const p of pages) {
            if (p !== page && (p.url() === 'about:blank' || !p.url().includes('zalo.me'))) {
                try { await p.close(); } catch (e) {}
            }
        }

        try {
            // Đặt chế độ hiển thị cửa sổ (maximize khi hiển thị)
            await this.browserManager.setWindowDisplayMode(page, showBrowser);
        await page.bringToFront();

        // Đợi Zalo Web sẵn sàng và kiểm tra đăng nhập
        console.log(`[ANCHOR SCANNER] ⏳ Đang kiểm tra trạng thái Zalo Web...`);
        const maxWaitMs = 25000;
        const waitStart = Date.now();
        let isChatReady = false;
        let needsQr = false;

        while (Date.now() - waitStart < maxWaitMs) {
            if (this.isCancelled) {
                return { connected: true, cancelled: true, messagesScraped: 0, scrapedEvents: [], groupName, workDate: targetDate, reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.' };
            }
            await this.browserManager.handleActivatePopup(page);

            const check = await page.evaluate(() => {
                const chatReady = !!(
                    document.querySelector('#contact-search-input') || 
                    document.querySelector('.conv-item') || 
                    document.querySelector('#chatViewContainer') ||
                    document.querySelector('#conversationListId') ||
                    document.querySelector('#chatViewTitle') ||
                    document.querySelector('input[placeholder*="Tìm kiếm"]')
                );
                const qrReady = !!(document.querySelector('.qrcode, .login-wrap, .login-v2, .content-login, .login-body'));
                return { chatReady, qrReady };
            }).catch(() => ({ chatReady: false, qrReady: false }));

            if (check.chatReady) {
                isChatReady = true;
                break;
            }
            if (check.qrReady) {
                needsQr = true;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!isChatReady) {
            if (needsQr) {
                return {
                    connected: false,
                    needsLogin: true,
                    messagesScraped: 0,
                    reason: 'Cửa sổ Zalo đã mở nhưng chưa đăng nhập. Vui lòng quét mã QR trên màn hình trình duyệt để tiếp tục!'
                };
            }
            return {
                connected: false,
                messagesScraped: 0,
                reason: 'Giao diện Zalo Web tải quá lâu hoặc không phản hồi. Vui lòng thử lại.'
            };
        }

        if (this.isCancelled) {
            return { connected: true, cancelled: true, messagesScraped: 0, scrapedEvents: [], groupName, workDate: targetDate, reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.' };
        }

        // 2. Chuyển vào nhóm Zalo mục tiêu
        if (groupName) {
            const navRes = await this.navigateToGroup(page, groupName);
            if (!navRes || navRes.success === false) {
                return {
                    connected: true,
                    taskFound: false,
                    messagesScraped: 0,
                    reason: navRes?.reason || `Không thể mở nhóm "${groupName}" trên Zalo.`
                };
            }
        }

        if (this.isCancelled) {
            return { connected: true, cancelled: true, messagesScraped: 0, scrapedEvents: [], groupName, workDate: targetDate, reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.' };
        }

        if (showBrowser) {
            await this.browserManager.bringToForeground(page);
        }

        // 3. Tìm mốc neo bắt đầu (Ưu tiên: Báo cáo hôm trước; Fallback: Nhiệm vụ ngày workDate)
        const anchorResult = await this.findAndJumpToStartAnchor(page, targetDate, options);

        if (this.isCancelled || anchorResult.cancelled) {
            return {
                connected: true,
                cancelled: true,
                taskFound: false,
                reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.',
                messagesScraped: 0,
                scrapedEvents: [],
                groupName,
                workDate: targetDate
            };
        }

        if (!anchorResult.found) {
            console.warn(`[ANCHOR SCANNER] ⚠️ ${anchorResult.error || 'Không tìm thấy mốc neo bắt đầu'}`);
            return {
                connected: true,
                taskFound: false,
                reason: anchorResult.error || `Chưa tìm thấy mốc neo bắt đầu (Báo cáo hôm trước hoặc Nhiệm vụ) cho ngày ${targetDate} trong nhóm "${groupName}".`,
                messagesScraped: 0,
                scrapedEvents: [],
                groupName,
                workDate: targetDate
            };
        }

        // 4. Cuộn XUỐNG thu thập tin nhắn nộp bài của Sứ giả
        const rawMessages = await this.collectMessagesDownward(page, targetDate, {
            ...options,
            anchorType: anchorResult.anchorType
        });

        if (this.isCancelled) {
            return {
                connected: true,
                cancelled: true,
                taskFound: true,
                reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.',
                messagesScraped: 0,
                scrapedEvents: [],
                groupName,
                workDate: targetDate
            };
        }

        // Chuẩn hóa danh sách sự kiện trả về theo cấu trúc raw_events
        const scrapedEvents = rawMessages.map((m, idx) => ({
            zalo_msg_id: m.uniqueKey || `anchor_${targetDate}_${idx}_${Date.now()}`,
            sender_zalo_name: m.sender,
            content_text: m.text,
            msg_type: m.hasImage ? 'image' : 'text',
            time_text: m.timeText,
            timestamp_ms: m.timestamp
        }));

            return {
                connected: true,
                taskFound: true,
                anchorType: anchorResult.anchorType,
                messagesScraped: scrapedEvents.length,
                scrapedEvents,
                groupName,
                workDate: targetDate
            };
        } catch (err) {
            const isTargetClosed = err.message && (
                err.message.includes('Target closed') ||
                err.message.includes('Session closed') ||
                err.message.includes('Execution context was destroyed') ||
                err.message.includes('Protocol error')
            );
            if (this.isCancelled || isTargetClosed) {
                console.log('[ANCHOR SCANNER] 🛑 Quá trình quét đã được dừng theo yêu cầu của bạn.');
                return {
                    connected: true,
                    cancelled: true,
                    taskFound: false,
                    reason: 'Quá trình quét đã được dừng theo yêu cầu của bạn.',
                    messagesScraped: 0,
                    scrapedEvents: [],
                    groupName,
                    workDate: targetDate
                };
            }
            throw err;
        } finally {
            this.currentPage = null;
        }
    }

    /**
     * Điều hướng vào đúng nhóm Zalo mục tiêu
     * @param {Object} page - Puppeteer Page
     * @param {string} groupName - Tên nhóm (vd: 'Vùng 31' hoặc 'SỨ GIẢ VÙNG 31')
     * @returns {Promise<{success: boolean, groupName?: string, reason?: string}>}
     */
    async navigateToGroup(page, groupName) {
        if (!groupName) return { success: false, reason: 'Tên nhóm không hợp lệ.' };
        const normTarget = groupName.trim().toLowerCase();
        const regionNumMatch = normTarget.match(/\b(\d{1,2})\b/);
        const regionNum = regionNumMatch ? regionNumMatch[1] : null;

        console.log(`[ANCHOR SCANNER] 🧭 Đang chuyển vào nhóm "${groupName}" (Số vùng: ${regionNum || 'N/A'})...`);
        await page.bringToFront();

        // 1. Kiểm tra xem tiêu đề chat hiện tại đã là nhóm mục tiêu chưa
        const checkCurrentHeader = async () => {
            return await page.evaluate((target, rNum) => {
                const header = document.querySelector('#chatViewTitle, .chat-title, .header-title, .chat-box__header, #headerBtns, [data-id="chat-title"]');
                const txt = (header ? header.textContent : '').trim().toLowerCase().replace(/\s+/g, ' ');
                if (!txt) return null;
                const matches = txt.includes(target) || (rNum && (txt.includes('vùng ' + rNum) || txt.includes('vung ' + rNum)));
                return { matches, raw: header ? header.textContent.trim() : '' };
            }, normTarget, regionNum);
        };

        const initialHeader = await checkCurrentHeader();
        if (initialHeader && initialHeader.matches) {
            console.log(`[ANCHOR SCANNER] ✅ Đang ở sẵn trong nhóm "${initialHeader.raw}".`);
            return { success: true, groupName: initialHeader.raw };
        }

        // 2. Thử tìm và click vào nhóm trong danh sách hội thoại gần đây bên trái
        const clickedRecent = await page.evaluate((target, rNum) => {
            const convs = Array.from(document.querySelectorAll('.conv-item, [class*="conv-item"], div[id^="conv-item-"]'));
            for (const c of convs) {
                const nameEl = c.querySelector('.conv-item-title, .name, [class*="name"], .truncate') || c;
                const text = (nameEl.innerText || nameEl.textContent || '').trim().toLowerCase();
                if (!text || text.length < 2) continue;

                const matches = text.includes(target) || 
                                (rNum && (text.includes('vùng ' + rNum) || text.includes('vung ' + rNum)));
                if (matches) {
                    c.click();
                    return { clicked: true, text: nameEl.textContent.trim() };
                }
            }
            return { clicked: false };
        }, normTarget, regionNum);

        if (clickedRecent.clicked) {
            console.log(`[ANCHOR SCANNER] 📌 Đã chọn hội thoại gần đây: "${clickedRecent.text}"`);
            await new Promise(r => setTimeout(r, 1500));
            const verify = await checkCurrentHeader();
            if (verify && verify.matches) {
                console.log(`[ANCHOR SCANNER] ✅ Đã chuyển vào nhóm "${verify.raw}".`);
                return { success: true, groupName: verify.raw };
            }
        }

        // 3. Nếu chưa vào được, dùng ô tìm kiếm chung #contact-search-input
        console.log(`[ANCHOR SCANNER] 🔍 Tìm kiếm nhóm "${groupName}" qua ô tìm kiếm Zalo...`);
        const searchSelectors = [
            '#contact-search-input',
            'input[placeholder*="Tìm kiếm"]',
            'input[data-translate-placeholder="STR_SEARCH"]'
        ];

        let searchInput = null;
        for (const sel of searchSelectors) {
            try {
                searchInput = await page.$(sel);
                if (searchInput) break;
            } catch (e) {}
        }

        if (!searchInput) {
            return {
                success: false,
                reason: 'Không tìm thấy ô tìm kiếm liên hệ trên giao diện Zalo.'
            };
        }

        try {
            // Click và focus vào ô tìm kiếm
            await page.evaluate((selList) => {
                for (const s of selList) {
                    const el = document.querySelector(s);
                    if (el) {
                        el.focus();
                        el.click();
                        return;
                    }
                }
            }, searchSelectors);
            await new Promise(r => setTimeout(r, 300));
            await searchInput.click();

            // Xóa nội dung tìm kiếm cũ và nhập từ khóa bằng React setter + CDP insertText (chống Unikey/EVKey nuốt ký tự "S", "V")
            const searchKeyword = regionNum ? `SỨ GIẢ VÙNG ${regionNum}` : groupName;
            console.log(`[ANCHOR SCANNER] ⌨️ Nhập từ khóa tìm kiếm: "${searchKeyword}"`);

            await page.evaluate((keyword) => {
                const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                if (inp) {
                    inp.focus();
                    inp.select();
                    try {
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(inp, keyword);
                        else inp.value = keyword;
                    } catch (e) {
                        inp.value = keyword;
                    }
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, keyword);
                    } catch (e) {}
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, searchKeyword);

            await new Promise(r => setTimeout(r, 400));

            // Kiểm tra xem input đã có đúng keyword chưa. Nếu bị Unikey can thiệp hoặc thiếu ký tự -> dùng CDP Input.insertText
            const currentVal = await page.evaluate(() => {
                const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                return inp ? inp.value : '';
            });

            if (currentVal !== searchKeyword) {
                try {
                    await searchInput.click();
                    await page.evaluate(() => {
                        const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                        if (inp) {
                            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                            if (nativeSetter) nativeSetter.call(inp, '');
                            else inp.value = '';
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    });
                    // CDP insertText chèn thẳng chuỗi Unicode vào input buffer của Chromium mà KHÔNG gửi phím OS -> 100% Unikey không bắt được
                    const client = await page.target().createCDPSession();
                    await client.send('Input.insertText', { text: searchKeyword });
                    await client.detach();
                    await page.evaluate(() => {
                        const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                        if (inp) {
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                } catch (cdpErr) {
                    console.warn('[ANCHOR SCANNER] Lỗi CDP insertText:', cdpErr.message);
                }
            }

            await new Promise(r => setTimeout(r, 1800));

            // Chọn kết quả từ dropdown tìm kiếm (#searchResultList)
            const clickedResult = await page.evaluate((target, rNum) => {
                const selectors = [
                    '#searchResultList .conv-item',
                    '#searchResultList [id^="group-item-"]',
                    '#searchResultList [class*="conv-item"]',
                    '.search-list-item',
                    '.conv-item',
                    '.search-item',
                    '[class*="search-item"]'
                ];
                const resultItems = Array.from(document.querySelectorAll(selectors.join(', ')));

                for (const item of resultItems) {
                    const txt = (item.innerText || item.textContent || '').trim().toLowerCase();
                    if (!txt || txt.length < 2) continue;
                    if (txt === 'tin nhắn' || txt === 'danh bạ' || txt === 'nhóm') continue;

                    if (txt.includes(target) || (rNum && (txt.includes('vùng ' + rNum) || txt.includes('vung ' + rNum)))) {
                        item.click();
                        return { clicked: true, text: (item.innerText || item.textContent).trim().substring(0, 50) };
                    }
                }

                // Nếu có số vùng, tìm thêm trường hợp "SỨ GIẢ ... <số vùng>"
                if (rNum) {
                    for (const item of resultItems) {
                        const txt = (item.innerText || item.textContent || '').trim().toLowerCase();
                        if (txt.includes(rNum) && (txt.includes('sứ giả') || txt.includes('vùng'))) {
                            item.click();
                            return { clicked: true, text: (item.innerText || item.textContent).trim().substring(0, 50) };
                        }
                    }
                }

                if (resultItems.length > 0) {
                    resultItems[0].click();
                    return { clicked: true, text: (resultItems[0].innerText || resultItems[0].textContent).trim().substring(0, 50) };
                }

                return { clicked: false };
            }, normTarget, regionNum);

            if (clickedResult.clicked) {
                console.log(`[ANCHOR SCANNER] 📌 Đã chọn kết quả tìm kiếm: "${clickedResult.text}"`);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.warn(`[ANCHOR SCANNER] ⚠️ Không thấy kết quả nào khớp với "${searchKeyword}".`);
            }
        } catch (err) {
            console.warn('[ANCHOR SCANNER] Lỗi khi thao tác ô tìm kiếm:', err.message);
        }

        // 4. Xác nhận tiêu đề nhóm thực tế
        let verifiedHeader = '';
        for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 600));
            const check = await checkCurrentHeader();
            if (check && check.matches) {
                console.log(`[ANCHOR SCANNER] ✅ Đã chuyển vào đúng nhóm: "${check.raw}".`);
                return { success: true, groupName: check.raw };
            }
            if (check && check.raw) {
                verifiedHeader = check.raw;
            }
        }

        if (!verifiedHeader) {
            return {
                success: false,
                reason: `Không thể mở nhóm "${groupName}" (khung chat chưa được kích hoạt). Vui lòng nhấp chọn nhóm "${groupName}" trực tiếp trên cửa sổ Zalo rồi thử lại!`
            };
        }

        return {
            success: false,
            reason: `Đang mở nhóm "${verifiedHeader}" thay vì nhóm "${groupName}". Vui lòng nhấp chọn nhóm "${groupName}" trên cửa sổ Zalo!`
        };
    }
}

const zaloAnchorScanner = new ZaloAnchorScanner();

module.exports = {
    ZaloAnchorScanner,
    zaloAnchorScanner
};
