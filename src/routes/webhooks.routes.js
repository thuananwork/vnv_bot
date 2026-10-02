const express = require('express');
const router = express.Router();

// POST /api/webhooks/zalo (Không sử dụng Zalo OA - Hệ thống dùng 100% Zalo Web)
router.post('/zalo', (req, res) => {
    res.status(200).json({ message: 'Zalo OA webhook is disabled. System uses Zalo Web Automation.' });
});

module.exports = router;
