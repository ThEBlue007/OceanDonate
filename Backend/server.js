const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let widgetSettings = { imgUrl: 'https://media.discordapp.net/attachments/934672365764349972/1480165647681065000/image.png', nameColor: '#f59e0b', amountColor: '#5BC0EB', textColor: '#ffffff', layout: 'main' };
let goalSettings = { title: 'ค่าอาหารหมา', target: 100, current: 0, barColor: '#0EA5E9', textColor: '#ffffff' };
let topDonorSettings = { title: '🏆 Top Donators', boxColor: 'rgba(0, 0, 0, 0.6)', titleColor: '#5BC0EB', textColor: '#ffffff', hasBorder: true, borderColor: '#3A86FF', isTransparent: false };

let stats = { today: 0, total: 0, views: 342 };
let pageSettings = { bio: "ยินดีต้อนรับสู่ช่องของ Zantots! สนับสนุนค่าขนมได้ที่นี่เลยครับ", thankMsg: "ขอบคุณสำหรับการสนับสนุนมากๆ ครับ! 🙏", yt: "", fb: "", twitch: "", bgUrl: "" };
let paymentSettings = { promptpay: { active: true, phone: '0946919475' }, bank: { active: true, bankName: 'KBANK', acc: '1961746848', owner: 'สันต์ทศน์ พ.' } };

// 📌 ระบบใหม่: เก็บประวัติ, รายชื่อท็อป, และคำต้องห้าม
let donatorsList = {};
let donationHistory = [];
let bannedWords = ['ควย', 'สัส', 'เหี้ย', 'พนัน', 'บาคาร่า']; // คำหยาบเริ่มต้น

function getTopDonators() { 
    return Object.entries(donatorsList).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5); 
}

io.on('connection', (socket) => {
    // ส่งข้อมูลเริ่มต้นทั้งหมด
    socket.emit('apply_settings', widgetSettings);
    socket.emit('apply_goal', goalSettings);
    socket.emit('apply_top_donor', topDonorSettings);
    socket.emit('update_stats', stats);
    socket.emit('apply_page_settings', pageSettings);
    socket.emit('apply_payment', paymentSettings);
    socket.emit('update_leaderboard', getTopDonators());
    socket.emit('apply_banned_words', bannedWords);
    socket.emit('update_history', donationHistory);

    // รับคำสั่งแก้ไขจาก Dashboard
    socket.on('update_settings', (data) => { widgetSettings = data; io.emit('apply_settings', widgetSettings); });
    socket.on('update_goal', (data) => { goalSettings = data; io.emit('apply_goal', goalSettings); });
    socket.on('update_top_donor', (data) => { topDonorSettings = data; io.emit('apply_top_donor', topDonorSettings); });
    socket.on('update_page_settings', (data) => { pageSettings = { ...pageSettings, ...data }; io.emit('apply_page_settings', pageSettings); });
    socket.on('update_payment', (data) => { paymentSettings = { ...paymentSettings, ...data }; io.emit('apply_payment', paymentSettings); });

    // 📌 รับคำสั่งอัปเดตคำต้องห้าม
    socket.on('update_banned_words', (words) => { 
        bannedWords = words; 
        io.emit('apply_banned_words', bannedWords); 
    });

    // 📌 รับคำสั่งลบประวัติการโดเนท
    socket.on('delete_donation', (id) => {
        const index = donationHistory.findIndex(d => d.id === id);
        if (index !== -1) {
            const deleted = donationHistory.splice(index, 1)[0];
            
            // หักยอดออกจากสถิติ
            stats.today -= deleted.amount; if(stats.today < 0) stats.today = 0;
            stats.total -= deleted.amount; if(stats.total < 0) stats.total = 0;
            goalSettings.current -= deleted.amount; if(goalSettings.current < 0) goalSettings.current = 0;
            
            // หักยอดออกจาก Top Donator
            if (donatorsList[deleted.name]) {
                donatorsList[deleted.name] -= deleted.amount;
                if (donatorsList[deleted.name] <= 0) delete donatorsList[deleted.name];
            }

            // แจ้งทุกหน้าต่างให้รีเฟรชข้อมูล
            io.emit('update_stats', stats);
            io.emit('apply_goal', goalSettings);
            io.emit('update_leaderboard', getTopDonators());
            io.emit('update_history', donationHistory);
        }
    });

    // 📌 ระบบรับโดเนทแบบมีการคัดกรอง
    socket.on('new_donation', (data) => {
        // ตรวจสอบคำหยาบก่อน (เผื่อหลุดมาจากหน้าเว็บ)
        const isBanned = bannedWords.some(word => data.name.includes(word) || data.message.includes(word));
        if (isBanned) {
            socket.emit('donation_rejected', { reason: 'ข้อความหรือชื่อของคุณมีคำต้องห้ามครับ' });
            return;
        }

        let amount = parseFloat(data.amount) || 0;

        // สร้างข้อมูลประวัติโดเนท
        const newDonate = {
            id: Date.now(),
            name: data.name,
            amount: amount,
            message: data.message,
            timestamp: new Date().toLocaleString('th-TH')
        };
        donationHistory.unshift(newDonate); // ใส่ไว้บรรทัดบนสุด

        io.emit('show_alert', data);
        goalSettings.current += amount; io.emit('apply_goal', goalSettings);
        stats.today += amount; stats.total += amount; io.emit('update_stats', stats);
        
        if (donatorsList[data.name]) donatorsList[data.name] += amount; else donatorsList[data.name] = amount;
        
        io.emit('update_leaderboard', getTopDonators());
        io.emit('update_history', donationHistory);
        socket.emit('donation_success'); // แจ้งกลับไปว่าสำเร็จแล้ว
    });
});

server.listen(3000, () => console.log(`🚀 Ocean Donate Server ทำงานที่พอร์ต 3000`));