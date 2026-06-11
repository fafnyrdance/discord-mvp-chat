const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

let messagesHistory = []; // Історія головного чату (#основний)
let registeredUsers = {}; // База акаунтів: { username.toLowerCase(): { username, password, id, avatar } }
let onlineUsers = {};     // Хто зараз в мережі: { socketId: { id, username, avatar, friends: [] } }

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Нове підключення');

    // ВХІД АБО РЕЄСТРАЦІЯ З ПАРОЛЕМ
    socket.on('register user', (data, callback) => {
        const username = data.username.trim();
        const password = data.password.trim();
        const lowerName = username.toLowerCase();

        if (username.length < 2 || password.length < 4) {
            return callback({ success: false, reason: "Нікнейм від 2 символів, пароль від 4 символів!" });
        }

        // Перевіряємо, чи цей юзер уже онлайн прямо зараз
        const isAlreadyOnline = Object.values(onlineUsers).some(u => u.username.toLowerCase() === lowerName);
        if (isAlreadyOnline) {
            return callback({ success: false, reason: "Цей користувач вже зайшов у чат з іншого пристрою!" });
        }

        let userAccount;

        if (registeredUsers[lowerName]) {
            // Акаунт існує — перевіряємо пароль
            if (registeredUsers[lowerName].password !== password) {
                return callback({ success: false, reason: "Невірний пароль для цього нікнейму!" });
            }
            userAccount = registeredUsers[lowerName];
        } else {
            // Акаунту немає — реєструємо новий
            const userId = Math.floor(1000 + Math.random() * 9000);
            userAccount = {
                id: userId,
                username: username,
                password: password,
                avatar: username.charAt(0).toUpperCase()
            };
            registeredUsers[lowerName] = userAccount; // Зберігаємо в "базу"
        }

        // Додаємо в список тих, хто онлайн
        onlineUsers[socket.id] = {
            id: userAccount.id,
            username: userAccount.username,
            avatar: userAccount.avatar,
            friends: onlineUsers[socket.id]?.friends || [] // зберігаємо друзів якщо були
        };

        // Прив'язуємо socket до кімнати з його особистим ID для ЛС
        socket.join(`user_${userAccount.id}`);

        callback({ success: true, user: onlineUsers[socket.id] });

        // Оновлюємо список для всіх
        io.emit('update users', Object.values(onlineUsers));
        
        // Шлемо історію загального чату
        socket.emit('load history', messagesHistory);
    });

    // ОБРОБКА ПОВІДОМЛЕНЬ (ЗАГАЛЬНІ ТА ОСОБИСТІ)
    socket.on('chat message', (data) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const msgObject = {
            text: data.text,
            user: currentUser.username,
            userId: currentUser.id,
            avatar: currentUser.avatar,
            time: timeString,
            isPrivate: !!data.toId, // прапорець особистого повідомлення
            toId: data.toId
        };

        if (data.toId) {
            // Особисте повідомлення: шлемо відправнику і отримувачу
            io.to(`user_${data.toId}`).to(`user_${currentUser.id}`).emit('chat message', msgObject);
        } else {
            // Загальний чат: зберігаємо в історію і шлемо всім
            messagesHistory.push(msgObject);
            if (messagesHistory.length > 100) messagesHistory.shift();
            io.emit('chat message', msgObject);
        }
    });

    // ДОДАВАННЯ В ДРУЗІ
    socket.on('add friend', (targetId, callback) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return callback({ success: false, reason: "Ви не увійшли!" });

        const searchId = parseInt(targetId);
        if (searchId === currentUser.id) return callback({ success: false, reason: "Не можна додати себе!" });

        const targetSocketId = Object.keys(onlineUsers).find(sid => onlineUsers[sid].id === searchId);
        if (!targetSocketId) return callback({ success: false, reason: "Користувач офлайн або не існує!" });

        const targetUser = onlineUsers[targetSocketId];

        if (currentUser.friends.includes(searchId)) {
            return callback({ success: false, reason: "Вже у друзях!" });
        }

        // Взаємно додаємо в масиви друзів
        currentUser.friends.push(searchId);
        targetUser.friends.push(currentUser.id);

        // Сповіщаємо того, КОМУ кинули запит
        io.to(targetSocketId).emit('friend added', { username: currentUser.username, id: currentUser.id });
        
        // КЛЮЧОВЕ ОНОВЛЕННЯ: розсилаємо новий список користувачів (з оновленими масивами друзів) ВСІМ
        io.emit('update users', Object.values(onlineUsers));

        callback({ success: true, friendName: targetUser.username, friendId: targetUser.id });
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
