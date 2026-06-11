const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

let messagesHistory = []; 
let registeredUsers = {}; // Тимчасовий кеш акаунтів (поки юзери онлайн)
let onlineUsers = {};     

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Нове підключення');

    // Реєстрація або авторизація з локальних даних ПК
    socket.on('register user', (data, callback) => {
        const username = data.username.trim();
        const password = data.password.trim();
        const lowerName = username.toLowerCase();
        let savedId = data.id ? parseInt(data.id) : null;

        if (username.length < 2 || password.length < 4) {
            return callback({ success: false, reason: "Нікнейм від 2 символів, пароль від 4 символів!" });
        }

        // Перевіряємо, чи цей юзер уже сидить в мережі прямо зараз
        const isAlreadyOnline = Object.values(onlineUsers).some(u => u.username.toLowerCase() === lowerName && u.id !== savedId);
        if (isAlreadyOnline) {
            return callback({ success: false, reason: "Цей користувач вже онлайн з іншого пристрою!" });
        }

        let userAccount;
        
        // Якщо користувач повернувся зі своїм ID з комп'ютера
        if (savedId && registeredUsers[lowerName]) {
            if (registeredUsers[lowerName].password !== password) {
                return callback({ success: false, reason: "Невірний пароль для відновлення сесії!" });
            }
            userAccount = registeredUsers[lowerName];
        } 
        // Якщо сервер перезапустився, але у юзера на ПК є старі дані — відновлюємо базу на сервері
        else if (savedId && !registeredUsers[lowerName]) {
            userAccount = {
                id: savedId,
                username: username,
                password: password,
                avatar: username.charAt(0).toUpperCase(),
                friends: data.friends || []
            };
            registeredUsers[lowerName] = userAccount;
        }
        // Абсолютно новий юзер без ID
        else {
            if (registeredUsers[lowerName]) {
                if (registeredUsers[lowerName].password !== password) {
                    return callback({ success: false, reason: "Цей нікнейм зайнятий!" });
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
        }

        // Садимо в онлайн
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

    socket.on('chat message', (data) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const msgObject = {
            text: data.text || null,
            audio: data.audio || null, 
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

    // WebRTC Сигналінг
    socket.on('call-user', (data) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;
        io.to(`user_${data.toId}`).emit('incoming-call', {
            fromId: currentUser.id,
            fromName: currentUser.username,
            offer: data.offer,
            video: data.video
        });
    });

    socket.on('accept-call', (data) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;
        io.to(`user_${data.toId}`).emit('call-accepted', {
            answer: data.answer
        });
    });

    socket.on('reject-or-end-call', (data) => {
        io.to(`user_${data.toId}`).emit('call-ended');
    });

    socket.on('ice-candidate', (data) => {
        io.to(`user_${data.toId}`).emit('ice-candidate', {
            candidate: data.candidate
        });
    });

    socket.on('add friend', (targetId, callback) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return callback({ success: false, reason: "Ви не увійшли!" });

        const searchId = parseInt(targetId);
        if (searchId === currentUser.id) return callback({ success: false, reason: "Не можна себе!" });

        // Шукаємо серед тих хто онлайн або створюємо зв'язок динамічно
        let myAccount = registeredUsers[currentUser.username.toLowerCase()];
        if (myAccount.friends.includes(searchId)) return callback({ success: false, reason: "Вже у друзях!" });

        myAccount.friends.push(searchId);
        currentUser.friends = myAccount.friends;

        const targetSocketId = Object.keys(onlineUsers).find(sid => onlineUsers[sid].id === searchId);
        if (targetSocketId) {
            onlineUsers[targetSocketId].friends.push(myAccount.id);
            io.to(targetSocketId).emit('friend added', { username: currentUser.username, id: myAccount.id });
        }

        io.emit('update users', Object.values(onlineUsers));
        callback({ success: true, friendId: searchId });
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
