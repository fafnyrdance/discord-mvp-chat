const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // Дозволяємо великі ГС файли (до 10 МБ)
});

app.use(express.static(path.join(__dirname, 'public')));

// Наша тимчасова база даних в оперативці
const users = {}; 
const messagesHistory = [];

io.on('connection', (socket) => {
    console.log('Клієнт підключився:', socket.id);

    // РЕЄСТРАЦІЯ ТА ВХІД
    socket.on('register user', (data, callback) => {
        const { username, password, id } = data;

        if (!username || !password) {
            return callback({ success: false, reason: "Нікнейм та пароль обов'язкові!" });
        }

        // 1. Авторизація за збереженою сесією (якщо є ID)
        if (id && users[id]) {
            if (users[id].password === password) {
                socket.userId = id;
                users[id].socketId = socket.id;
                users[id].online = true;
                
                callback({ success: true, user: users[id] });
                io.emit('update users', getOnlineUsersArray());
                socket.emit('load history', messagesHistory);
                return;
            } else {
                return callback({ success: false, reason: "Сесія застаріла. Увійдіть знову." });
            }
        }

        // 2. Шукаємо користувача за нікнеймом
        let existingUser = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());

        if (existingUser) {
            // Якщо користувач існує — перевіряємо пароль (Вхід)
            if (existingUser.password === password) {
                socket.userId = existingUser.id;
                existingUser.socketId = socket.id;
                existingUser.online = true;

                callback({ success: true, user: existingUser });
                io.emit('update users', getOnlineUsersArray());
                socket.emit('load history', messagesHistory);
            } else {
                callback({ success: false, reason: "Неправильний пароль для цього нікнейму!" });
            }
        } else {
            // Якщо нікнейму немає — створюємо нового (Реєстрація)
            const newId = Math.floor(1000 + Math.random() * 9000); // 4-значний ID
            const avatarLetter = username.charAt(0).toUpperCase();

            const newUser = {
                id: newId,
                username: username,
                password: password,
                avatar: avatarLetter,
                socketId: socket.id,
                friends: [],
                online: true
            };

            users[newId] = newUser;
            socket.userId = newId;

            callback({ success: true, user: newUser });
            io.emit('update users', getOnlineUsersArray());
            socket.emit('load history', messagesHistory);
        }
    });

    // ДОДАННЯ В ДРУЗІ
    socket.on('add friend', (targetId, callback) => {
        const myId = socket.userId;
        if (!myId || !users[myId]) return callback({ success: false, reason: "Ви не авторизовані" });

        if (myId === targetId) {
            return callback({ success: false, reason: "Не можна додати самого себе!" });
        }

        const targetUser = users[targetId];
        if (!targetUser) {
            return callback({ success: false, reason: "Користувача з таким ID не знайдено!" });
        }

        // Перевіряємо, чи вже не в друзях
        if (!users[myId].friends.includes(targetId)) {
            users[myId].friends.push(targetId);
        }
        if (!targetUser.friends.includes(myId)) {
            targetUser.friends.push(myId);
        }

        callback({ success: true });

        // Оновлюємо списки в обох
        io.emit('update users', getOnlineUsersArray());

        // Повідомляємо друга, якщо він онлайн
        if (targetUser.online && targetUser.socketId) {
            io.to(targetUser.socketId).emit('friend added', { id: myId, username: users[myId].username });
        }
    });

    // ПОВІДОМЛЕННЯ (ЧАТ ТА ГС)
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
            toId: msgData.toId
        };

        if (fullMsg.isPrivate) {
            // Відправляємо в ЛС (собі і другу)
            const targetUser = users[msgData.toId];
            if (targetUser && targetUser.socketId && targetUser.online) {
                io.to(targetUser.socketId).emit('chat message', fullMsg);
            }
            socket.emit('chat message', fullMsg);
            messagesHistory.push(fullMsg); // Зберігаємо в історію
        } else {
            // Загальний чат
            io.emit('chat message', fullMsg);
            messagesHistory.push(fullMsg);
        }
    });

    // СИГНАЛІНГ ДЛЯ ДЗВІНКІВ (WebRTC)
    socket.on('call-user', (data) => {
        const myId = socket.userId;
        if (!myId || !users[myId]) return;

        const targetUser = users[data.toId];
        if (targetUser && targetUser.online && targetUser.socketId) {
            io.to(targetUser.socketId).emit('incoming-call', {
                fromId: myId,
                fromName: users[myId].username,
                offer: data.offer,
                video: data.video
            });
        }
    });

    socket.on('accept-call', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.online && targetUser.socketId) {
            io.to(targetUser.socketId).emit('call-accepted', {
                answer: data.answer
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.online && targetUser.socketId) {
            io.to(targetUser.socketId).emit('ice-candidate', {
                candidate: data.candidate
            });
        }
    });

    socket.on('reject-or-end-call', (data) => {
        const targetUser = users[data.toId];
        if (targetUser && targetUser.online && targetUser.socketId) {
            io.to(targetUser.socketId).emit('call-ended');
        }
    });

    // ВІДКЛЮЧЕННЯ
    socket.on('disconnect', () => {
        if (socket.userId && users[socket.userId]) {
            users[socket.userId].online = false;
            console.log(`Користувач офлайн: ${users[socket.userId].username}`);
            io.emit('update users', getOnlineUsersArray());
        }
    });
});

function getOnlineUsersArray() {
    return Object.values(users).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        online: u.online,
        friends: u.friends
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущено на порту ${PORT}`);
});
