const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// База даних в оперативці
const users = {}; 
const servers = {}; // { serverId: { id, name, ownerId, channels: { channelName: [messages] } } }

io.on('connection', (socket) => {
    console.log('Клієнт підключився:', socket.id);

    // АВТОРИЗАЦІЯ ТА РЕЄСТРАЦІЯ
    socket.on('register user', (data, callback) => {
        const { username, password, id } = data;
        if (!username || !password) return callback({ success: false, reason: "Нікнейм та пароль обов'язкові!" });

        if (id && users[id]) {
            if (users[id].password === password) {
                socket.userId = id;
                users[id].socketId = socket.id;
                users[id].online = true;
                callback({ success: true, user: users[id] });
                io.emit('update users', users);
                return;
            }
        }

        let existingUser = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
        if (existingUser) {
            if (existingUser.password === password) {
                socket.userId = existingUser.id;
                existingUser.socketId = socket.id;
                existingUser.online = true;
                callback({ success: true, user: existingUser });
                io.emit('update users', users);
            } else {
                callback({ success: false, reason: "Неправильний пароль!" });
            }
        } else {
            const newId = Math.floor(1000 + Math.random() * 9000); 
            const newUser = {
                id: newId,
                username: username,
                password: password,
                avatar: "", // URL аватарки
                customStatus: "", // Текст статусу
                statusType: "online", // online, dnd, invisible
                aboutMe: "",
                socketId: socket.id,
                friends: [],
                servers: [],
                online: true
            };
            users[newId] = newUser;
            socket.userId = newId;
            callback({ success: true, user: newUser });
            io.emit('update users', users);
        }
    });

    // ОНОВЛЕННЯ ПРОФІЛЮ В СТИЛІ ДС
    socket.on('update profile', (data, callback) => {
        const myId = socket.userId;
        if (!myId || !users[myId]) return callback({ success: false });

        users[myId].avatar = data.avatar || "";
        users[myId].customStatus = data.customStatus || "";
        users[myId].statusType = data.statusType || "online";
        users[myId].aboutMe = data.aboutMe || "";

        callback({ success: true, user: users[myId] });
        io.emit('update users', users);
    });

    // ДІЇ З СЕРВЕРАМИ (СТВОРЕННЯ / ПРИЄДНАННЯ)
    socket.on('create server', (serverName, callback) => {
        const myId = socket.userId;
        if (!myId || !users[myId]) return callback({ success: false });

        const serverId = Math.floor(100000 + Math.random() * 900000); // 6-значний ID сервера
        const newServer = {
            id: serverId,
            name: serverName,
            ownerId: myId,
            members: [myId],
            channels: {
                "загальний": [],
                "флуд": []
            }
        };

        servers[serverId] = newServer;
        users[myId].servers.push(serverId);
        socket.join(`server-${serverId}`);

        callback({ success: true, server: newServer });
        io.emit('update users', users);
    });

    socket.on('join server', (serverId, callback) => {
        const myId = socket.userId;
        serverId = parseInt(serverId);
        if (!myId || !users[myId] || !servers[serverId]) return callback({ success: false, reason: "Сервер не знайдено!" });

        if (!servers[serverId].members.includes(myId)) {
            servers[serverId].members.push(myId);
        }
        if (!users[myId].servers.includes(serverId)) {
            users[myId].servers.push(serverId);
        }

        socket.join(`server-${serverId}`);
        callback({ success: true, server: servers[serverId] });
        io.emit('update users', users);
    });

    // НАЛАШТУВАННЯ СЕРВЕРА (СТВОРЕННЯ КАНАЛУ / ВИДАЛЕННЯ)
    socket.on('create channel', (data, callback) => {
        const { serverId, channelName } = data;
        const srv = servers[serverId];
        if (!srv || srv.ownerId !== socket.userId) return callback({ success: false, reason: "Тільки власник може створювати канали!" });

        if (!srv.channels[channelName]) {
            srv.channels[channelName] = [];
            io.to(`server-${serverId}`).emit('server updated', srv);
            callback({ success: true });
        } else {
            callback({ success: false, reason: "Канал вже існує!" });
        }
    });

    socket.on('get server info', (serverId, callback) => {
        if (servers[serverId]) callback({ success: true, server: servers[serverId] });
        else callback({ success: false });
    });

    // ДОДАННЯ В ДРУЗІ
    socket.on('add friend', (targetId, callback) => {
        const myId = socket.userId;
        if (!myId || !users[myId] || myId === targetId || !users[targetId]) return callback({ success: false, reason: "Помилка додавання" });

        if (!users[myId].friends.includes(targetId)) users[myId].friends.push(targetId);
        if (!users[targetId].friends.includes(myId)) users[targetId].friends.push(myId);

        callback({ success: true });
        io.emit('update users', users);
        if (users[targetId].online && users[targetId].socketId) {
            io.to(users[targetId].socketId).emit('friend added', { id: myId, username: users[myId].username });
        }
    });

    // ПОВІДОМЛЕННЯ (ЧАТ СЕРВЕРА АБО ЛС)
    socket.on('chat message', (msgData) => {
        const myId = socket.userId;
        if (!myId || !users[myId]) return;

        const sender = users[myId];
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const fullMsg = {
            user: sender.username,
            userId: myId,
            avatar: sender.avatar,
            text: msgData.text,
            audio: msgData.audio, 
            time: timeNow,
            isPrivate: msgData.toId ? true : false,
            toId: msgData.toId,
            serverId: msgData.serverId,
            channel: msgData.channel
        };

        if (fullMsg.isPrivate) {
            const targetUser = users[msgData.toId];
            if (targetUser && targetUser.socketId && targetUser.online) io.to(targetUser.socketId).emit('chat message', fullMsg);
            socket.emit('chat message', fullMsg);
        } else if (fullMsg.serverId && servers[fullMsg.serverId]) {
            // Зберігаємо в історію каналу сервера
            if (servers[fullMsg.serverId].channels[fullMsg.channel]) {
                servers[fullMsg.serverId].channels[fullMsg.channel].push(fullMsg);
                io.to(`server-${fullMsg.serverId}`).emit('chat message', fullMsg);
            }
        }
    });

    // СИГНАЛІНГ ДЛЯ ДЗВІНКІВ
    socket.on('call-user', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.socketId) {
            io.to(targetUser.socketId).emit('incoming-call', { fromId: socket.userId, fromName: users[socket.userId].username, offer: data.offer, video: data.video });
        }
    });
    socket.on('accept-call', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.socketId) io.to(targetUser.socketId).emit('call-accepted', { answer: data.answer });
    });
    socket.on('ice-candidate', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.socketId) io.to(targetUser.socketId).emit('ice-candidate', { candidate: data.candidate });
    });
    socket.on('reject-or-end-call', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.socketId) io.to(targetUser.socketId).emit('call-ended');
    });

    socket.on('disconnect', () => {
        if (socket.userId && users[socket.userId]) {
            users[socket.userId].online = false;
            io.emit('update users', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер працює на порту ${PORT}`));
