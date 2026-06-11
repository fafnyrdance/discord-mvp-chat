const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

let messagesHistory = []; 
let registeredUsers = {}; // База акаунтів
let onlineUsers = {};     // Хто в мережі

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Нове підключення');

    socket.on('register user', (data, callback) => {
        const username = data.username.trim();
        const password = data.password.trim();
        const lowerName = username.toLowerCase();

        if (username.length < 2 || password.length < 4) {
            return callback({ success: false, reason: "Нікнейм від 2 символів, пароль від 4 символів!" });
        }

        const isAlreadyOnline = Object.values(onlineUsers).some(u => u.username.toLowerCase() === lowerName);
        if (isAlreadyOnline) {
            return callback({ success: false, reason: "Цей користувач вже онлайн!" });
        }

        let userAccount;
        if (registeredUsers[lowerName]) {
            if (registeredUsers[lowerName].password !== password) {
                return callback({ success: false, reason: "Невірний пароль!" });
            }
            userAccount = registeredUsers[lowerName];
        } else {
            const userId = Math.floor(1000 + Math.random() * 9000);
            userAccount = {
                id: userId,
                username: username,
                password: password,
                avatar: username.charAt(0).toUpperCase(),
                friends: []
            };
            registeredUsers[lowerName] = userAccount;
        }

        onlineUsers[socket.id] = {
            id: userAccount.id,
            username: userAccount.username,
            avatar: userAccount.avatar,
            friends: userAccount.friends
        };

        socket.join(`user_${userAccount.id}`);
        callback({ success: true, user: onlineUsers[socket.id] });

        io.emit('update users', Object.values(onlineUsers));
        socket.emit('load history', messagesHistory);
    });

    // УНІВЕРСАЛЬНА ОБРОБКА ПОВІДОМЛЕНЬ (ТЕКСТ АБО ГС)
    socket.on('chat message', (data) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const msgObject = {
            text: data.text || null,
            audio: data.audio || null, // Тут зберігатиметься аудіо в форматі base64
            user: currentUser.username,
            userId: currentUser.id,
            avatar: currentUser.avatar,
            time: timeString,
            isPrivate: !!data.toId,
            toId: data.toId
        };

        if (data.toId) {
            io.to(`user_${data.toId}`).to(`user_${currentUser.id}`).emit('chat message', msgObject);
        } else {
            messagesHistory.push(msgObject);
            if (messagesHistory.length > 100) messagesHistory.shift();
            io.emit('chat message', msgObject);
        }
    });

    socket.on('add friend', (targetId, callback) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return callback({ success: false, reason: "Ви не увійшли!" });

        const searchId = parseInt(targetId);
        if (searchId === currentUser.id) return callback({ success: false, reason: "Не можна себе!" });

        const targetUserAccount = Object.values(registeredUsers).find(u => u.id === searchId);
        if (!targetUserAccount) return callback({ success: false, reason: "Користувача не існує!" });

        const myAccount = registeredUsers[currentUser.username.toLowerCase()];
        if (myAccount.friends.includes(searchId)) return callback({ success: false, reason: "Вже у друзях!" });

        myAccount.friends.push(searchId);
        targetUserAccount.friends.push(myAccount.id);
        currentUser.friends = myAccount.friends;

        const targetSocketId = Object.keys(onlineUsers).find(sid => onlineUsers[sid].id === searchId);
        if (targetSocketId) {
            onlineUsers[targetSocketId].friends = targetUserAccount.friends;
            io.to(targetSocketId).emit('friend added', { username: currentUser.username, id: myAccount.id });
        }

        io.emit('update users', Object.values(onlineUsers));
        callback({ success: true, friendName: targetUserAccount.username, friendId: targetUserAccount.id });
    });

    socket.on('disconnect', () => {
        if (onlineUsers[socket.id]) {
            delete onlineUsers[socket.id];
            io.emit('update users', Object.values(onlineUsers));
        }
    });
});

http.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
