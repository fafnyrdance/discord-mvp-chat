const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// База даних
const users = {};
const servers = {};

io.on('connection', (socket) => {
    console.log('Клієнт підключився:', socket.id);

    // Реєстрація та вхід
    socket.on('register user', (data, callback) => {
        let user = Object.values(users).find(u => u.username === data.username);
        if (!user) {
            user = { id: Math.floor(1000 + Math.random() * 9000), ...data, avatar: "", customStatus: "", statusType: "online", aboutMe: "", friends: [], servers: [], online: true };
            users[user.id] = user;
        } else {
            user.online = true;
        }
        socket.userId = user.id;
        user.socketId = socket.id;
        callback({ success: true, user });
        io.emit('update users', users);
    });

    // Оновлення профілю
    socket.on('update profile', (data, callback) => {
        if (users[socket.userId]) {
            Object.assign(users[socket.userId], data);
            io.emit('update users', users);
            callback({ success: true, user: users[socket.userId] });
        }
    });

    // Сервери
    socket.on('create server', (name, callback) => {
        const id = Math.floor(100000 + Math.random() * 900000);
        servers[id] = { id, name, ownerId: socket.userId, channels: { "загальний": [] } };
        users[socket.userId].servers.push(id);
        socket.join(`server-${id}`);
        callback({ success: true, server: servers[id] });
        io.emit('update users', users);
    });

    // Повідомлення
    socket.on('chat message', (msg) => {
        const fullMsg = { ...msg, user: users[socket.userId].username, time: new Date().toLocaleTimeString() };
        if (msg.serverId) {
            servers[msg.serverId].channels[msg.channel].push(fullMsg);
            io.to(`server-${msg.serverId}`).emit('chat message', fullMsg);
        } else {
            io.to(users[msg.toId]?.socketId).emit('chat message', fullMsg);
            socket.emit('chat message', fullMsg);
        }
    });

    // WebRTC сигналінг
    socket.on('call-user', (data) => io.to(users[data.toId]?.socketId).emit('incoming-call', { fromId: socket.userId, ...data }));
    socket.on('accept-call', (data) => io.to(users[data.toId]?.socketId).emit('call-accepted', { answer: data.answer }));
    socket.on('ice-candidate', (data) => io.to(users[data.toId]?.socketId).emit('ice-candidate', { candidate: data.candidate }));
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`>>> СЕРВЕР ЗАПУЩЕНО НА ПОРТУ ${PORT} <<<`));
