const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

let messagesHistory = [];
let usersList = {}; // Сюди записуємо { socketId: { id, username, avatar } }

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Нове підключення');

    // 1. ПЕРЕВІРКА НІКНЕЙМУ ПРИ РЕЄСТРАЦІЇ
    socket.on('register user', (requestedName, callback) => {
        const nameTrimmed = requestedName.trim();
        
        // Перевіряємо, чи є вже юзер з таким ім'ям
        const isTaken = Object.values(usersList).some(
            u => u.username.toLowerCase() === nameTrimmed.toLowerCase()
        );

        if (isTaken || nameTrimmed.length < 2) {
            callback({ success: false, reason: "Цей нікнейм уже зайнятий або занадто короткий!" });
        } else {
            // Генеруємо унікальний ID (наприклад, 4 цифри, як у старому Discord)
            const userId = Math.floor(1000 + Math.random() * 9000);
            
            usersList[socket.id] = {
                id: userId,
                username: nameTrimmed,
                avatar: nameTrimmed.charAt(0).toUpperCase(),
                friends: [] // Список ID друзів
            };

            callback({ 
                success: true, 
                user: usersList[socket.id] 
            });

            // Оновлюємо список онлайн-користувачів для всіх
            io.emit('update users', Object.values(usersList));
            
            // Відправляємо новому юзеру історію чату
            socket.emit('load history', messagesHistory);
        }
    });

    // 2. ОБРОБКА ПОВІДОМЛЕНЬ
    socket.on('chat message', (text) => {
        const currentUser = usersList[socket.id];
        if (!currentUser) return;

        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const msgObject = {
            text: text,
            user: currentUser.username,
            userId: currentUser.id,
            avatar: currentUser.avatar,
            time: timeString
        };

        messagesHistory.push(msgObject);
        if (messagesHistory.length > 100) messagesHistory.shift();

        io.emit('chat message', msgObject);
    });

    // 3. ДОДАВАННЯ В ДРУЗІ ПО ID
    socket.on('add friend', (targetId, callback) => {
        const currentUser = usersList[socket.id];
        if (!currentUser) return callback({ success: false, reason: "Ви не зареєстровані!" });

        const searchId = parseInt(targetId);
        if (searchId === currentUser.id) {
            return callback({ success: false, reason: "Не можна додати самого себе!" });
        }

        // Шукаємо юзера за його ID в системі
        const targetSocketId = Object.keys(usersList).find(sid => usersList[sid].id === searchId);

        if (!targetSocketId) {
            return callback({ success: false, reason: "Користувача з таким ID не знайдено в мережі!" });
        }

        const targetUser = usersList[targetSocketId];

        // Перевіряємо, чи він уже не в друзях
        if (currentUser.friends.includes(searchId)) {
            return callback({ success: false, reason: "Цей користувач вже у вас у друзях!" });
        }

        // Додаємо взаємно в друзі
        currentUser.friends.push(searchId);
        targetUser.friends.push(currentUser.id);

        // Повідомляємо того, кого додали (якщо він онлайн)
        io.to(targetSocketId).emit('friend added', { username: currentUser.username, id: currentUser.id });

        callback({ success: true, friendName: targetUser.username, friendId: targetUser.id });
    });

    // 4. ВІДКЛЮЧЕННЯ
    socket.on('disconnect', () => {
        if (usersList[socket.id]) {
            delete usersList[socket.id];
            io.emit('update users', Object.values(usersList));
        }
        console.log('Користувач відключився');
    });
});

http.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
