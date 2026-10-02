/**
 * Lớp cơ sở trừu tượng định nghĩa giao diện (Interface) cho Zalo Provider
 */
class ZaloProvider {
    /**
     * Gửi tin nhắn văn bản thông thường
     * @param {string} recipientId - ID người nhận (hoặc tên nhóm)
     * @param {string} messageContent - Nội dung tin nhắn
     * @returns {Promise<boolean>}
     */
    async sendMessage(recipientId, messageContent) {
        throw new Error('sendMessage() must be implemented by subclasses');
    }

    /**
     * Gửi tin nhắn template Zalo OA
     * @param {string} recipientId 
     * @param {string} templateId 
     * @param {Object} templateData 
     * @returns {Promise<boolean>}
     */
    async sendTemplateMessage(recipientId, templateId, templateData) {
        throw new Error('sendTemplateMessage() must be implemented by subclasses');
    }

    /**
     * Khởi động lắng nghe tin nhắn sự kiện từ nguồn Zalo
     * @param {Function} onMessageCallback - Hàm callback nhận tin nhắn đã chuẩn hóa
     */
    async startListening(onMessageCallback) {
        throw new Error('startListening() must be implemented by subclasses');
    }

    /**
     * Kiểm tra xem provider có hỗ trợ tính năng cụ thể hay không
     * @param {string} feature - Tên tính năng (e.g. 'template', 'image', 'recall', 'attachment')
     * @returns {boolean}
     */
    supports(feature) {
        throw new Error('supports() must be implemented by subclasses');
    }
}

module.exports = ZaloProvider;
