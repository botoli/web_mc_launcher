const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const journalActions = {
    auth: new Set(['login', 'logout', 'password_check', 'sessions_revoked']),
    connections: new Set(['connect', 'disconnect', 'connection_denied']),
    account: new Set(['registered', 'nickname_changed', 'email_changed', 'password_changed', 'telegram_linked', 'telegram_unlinked', 'telegram_username_changed', 'discord_linked', 'discord_unlinked']),
    moderation: new Set(['ban', 'unban', 'freeze', 'unfreeze', 'status_changed', 'role_changed']),
    administration: new Set(['mod_added', 'mod_replaced', 'mod_deleted', 'configs_added', 'configs_replaced', 'build_config_changed']),
};
const journalEvent = event => journalActions[event.category]?.has(event.action) === true;

function createPlayerServices({ users, saveUsers, dataDir, now = Date.now, storage }) {
    const journal = path.join(dataDir, 'player-events.jsonl');
    // Hide obsolete request/click telemetry without rewriting the historical journal.
    const legacyEvents = !storage && fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(journalEvent) : [];
    const getEvents = () => storage ? storage.events().filter(journalEvent) : legacyEvents;
    const roleManagerLogin = 'botoli1';
    function role(login) {
        if (login === roleManagerLogin) return 'admin';
        return own(users, login) && users[login].role === 'admin' ? 'admin' : 'player';
    }
    const canManageRoles = login => login === roleManagerLogin;
    function restriction(user) {
        if (user.registrationStatus === 'banned') return 'Аккаунт заблокирован в лаунчере';
        if (user.frozenUntil > now()) return `Аккаунт заморожен до ${new Date(user.frozenUntil).toISOString()}`;
        return null;
    }
    function profile(login) {
        const u = users[login];
        return {
            login, nickname: u.nickname || login, email: u.email || '',
            registrationStatus: u.registrationStatus || 'confirmed', role: role(login), canManageRoles: canManageRoles(login),
            registeredAt: u.registeredAt || u.created || 0, lastLogin: u.lastLogin || null,
            telegramId: u.telegramId == null ? null : String(u.telegramId),
            discordId: u.discordId == null ? null : String(u.discordId),
            telegramUsername: u.telegramUsername || '', discordUsername: u.discordUsername || '',
            frozenUntil: u.frozenUntil > now() ? u.frozenUntil : null,
            moderationReason: restriction(u) ? u.moderationReason || '' : '',
        };
    }
    function audit(req, login, category, action, details = {}) {
        if (!journalEvent({ category, action })) return;
        const user = own(users, login) ? users[login] : null;
        if (!user && !details.telegramId && !details.discordId) return;
        // Only explicitly selected fields enter the journal. Credentials and request bodies never do.
        const event = {
            id: crypto.randomUUID(), at: now(), login: user ? login : '', nickname: user?.nickname || login || '',
            category, action, actor: details.actor || login || (details.telegramId ? `telegram:${details.telegramId}` : `discord:${details.discordId}`),
            source: text(details.source || 'website', 40), method: text(details.method, 40),
            outcome: details.outcome || 'success',
            ip: text(details.ip ?? req?.ip ?? req?.socket?.remoteAddress, 64),
            userAgent: text(details.userAgent ?? req?.get?.('user-agent'), 300),
            bot: text(details.bot, 64), target: text(details.target || (category === 'auth' ? details.source === 'telegram' ? 'launcher' : details.source || 'website' : ''), 200),
            reason: text(details.reason), telegramId: text(details.telegramId ?? (user?.telegramId == null ? '' : String(user.telegramId)), 64), discordId: text(details.discordId ?? (user?.discordId == null ? '' : String(user.discordId)), 64),
            telegramUsername: text(details.telegramUsername ?? user?.telegramUsername, 64),
            discordUsername: text(details.discordUsername ?? user?.discordUsername, 64),
        };
        if (storage) storage.events().push(event);
        else {
            fs.appendFileSync(journal, JSON.stringify(event) + '\n', { mode: 0o600 });
            legacyEvents.push(event);
        }
        return event;
    }
    const recent = (login, limit = 10) => getEvents().filter(e => e.login === login).slice(-limit).reverse();
    function install(app, authRequired) {
        const adminRequired = (req, res, next) => authRequired(req, res, () => {
            if (role(req.user.login) !== 'admin') return res.status(403).json({ error: 'Нужны права администратора' });
            next();
        });
        app.use('/api/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
        app.put('/api/admin/players/:login/role', authRequired, (req, res) => {
            if (!canManageRoles(req.user.login)) return res.status(403).json({ error: 'Назначать роли может только botoli1' });
            const { login } = req.params;
            if (!own(users, login)) return res.status(404).json({ error: 'Игрок не найден' });
            const nextRole = req.body.role;
            if (!['admin', 'player'].includes(nextRole)) return res.status(400).json({ error: 'Допустимы роли админ и игрок' });
            if (canManageRoles(login) && nextRole !== 'admin') return res.status(409).json({ error: 'Нельзя снять роль администратора у botoli1' });
            const previousRole = role(login);
            if (previousRole !== nextRole) {
                users[login].role = nextRole;
                saveUsers();
                audit(req, login, 'moderation', 'role_changed', { actor: req.user.login, target: nextRole, reason: `Предыдущая роль: ${previousRole}` });
            }
            res.json({ success: true, player: profile(login) });
        });
        app.get('/api/admin/players/:login', adminRequired, (req, res) => {
            if (!own(users, req.params.login)) return res.status(404).json({ error: 'Игрок не найден' });
            res.json(profile(req.params.login));
        });
        app.get('/api/admin/logs/options', adminRequired, (req, res) => {
            const players = new Map(Object.keys(users).map(login => [login, { ...profile(login), id: login }]));
            for (const event of getEvents()) {
                const id = event.login || (event.telegramId ? `telegram:${event.telegramId}` : `discord:${event.discordId}`);
                if (!players.has(id)) players.set(id, { id, login: event.login, nickname: event.nickname,
                    telegramId: event.telegramId, discordId: event.discordId,
                    telegramUsername: event.telegramUsername, discordUsername: event.discordUsername });
                const player = players.get(id);
                player.identifiers ||= new Set();
                for (const value of [event.nickname, event.telegramId, event.discordId, event.telegramUsername, event.discordUsername]) if (value) player.identifiers.add(value);
            }
            res.json({ players: [...players.values()].map(({ id, login, nickname, telegramId, discordId, telegramUsername, discordUsername, identifiers }) =>
                ({ id, login, nickname, telegramId, discordId, telegramUsername, discordUsername, search: [...(identifiers || [])].join(' ') })),
                actions: Object.entries(journalActions).flatMap(([category, actions]) => [...actions].map(value => ({ value, category }))) });
        });
        app.get(['/api/admin/logs', '/api/admin/players/:login/actions'], adminRequired, (req, res) => {
            const login = req.params.login || text(req.query.login, 100);
            if (login && !own(users, login)) return res.status(404).json({ error: 'Игрок не найден' });
            const category = text(req.query.category, 20);
            const outcome = text(req.query.outcome, 20), query = text(req.query.q, 200).toLowerCase();
            const values = value => (Array.isArray(value) ? value : [value]).flatMap(item => text(item, 5000).split(',')).filter(Boolean);
            const players = values(req.query.players), actions = values(req.query.actions), sources = values(req.query.source);
            const sort = text(req.query.sort, 20) || 'date', direction = req.query.direction === 'asc' ? 1 : -1;
            if (!['date', 'player', 'outcome'].includes(sort)) return res.status(400).json({ error: 'Некорректная сортировка' });
            const from = req.query.from ? Date.parse(req.query.from) : null;
            const to = req.query.to ? Date.parse(req.query.to) : null;
            if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to))
                return res.status(400).json({ error: 'Некорректный период' });
            const requestedPage = Number(req.query.page || 1), requestedLimit = Number(req.query.limit || 30);
            if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1)
                return res.status(400).json({ error: 'Некорректные параметры страницы' });
            const limit = Math.min(100, requestedLimit);
            const found = getEvents().filter(e => (!login || e.login === login) && (!category || e.category === category) &&
                (!players.length || players.includes(e.login) || (!e.login && (players.includes(`telegram:${e.telegramId}`) || players.includes(`discord:${e.discordId}`)))) &&
                (!actions.length || actions.includes(e.action)) && (!sources.length || sources.includes(e.source)) && (!outcome || e.outcome === outcome) &&
                (from === null || e.at >= from) && (to === null || e.at <= to) &&
                (!query || [e.login, e.nickname, users[e.login]?.nickname, e.ip, e.action, e.actor, e.target, e.bot, e.reason, e.telegramId, e.discordId, e.telegramUsername, e.discordUsername].some(v => String(v || '').toLowerCase().includes(query))));
            found.sort((a, b) => {
                const comparison = sort === 'date' ? a.at - b.at : sort === 'player'
                    ? (a.nickname || a.login).localeCompare(b.nickname || b.login, 'ru', { numeric: true, sensitivity: 'base' })
                    : a.outcome.localeCompare(b.outcome);
                return comparison * direction || b.at - a.at || b.id.localeCompare(a.id);
            });
            const page = Math.min(requestedPage, Math.max(1, Math.ceil(found.length / limit)));
            res.json({ items: found.slice((page - 1) * limit, page * limit), total: found.length, page, limit });
        });
        app.post('/api/admin/players/:login/moderation', adminRequired, (req, res) => {
            const { login } = req.params;
            if (!own(users, login)) return res.status(404).json({ error: 'Игрок не найден' });
            const { action, hours } = req.body;
            const reason = text(req.body.reason);
            if (!['ban', 'unban', 'freeze', 'unfreeze'].includes(action)) return res.status(400).json({ error: 'Неизвестное действие' });
            if (action === 'freeze' && (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 8760))
                return res.status(400).json({ error: 'Укажите срок от 0 до 8760 часов, больше нуля' });
            if (['ban', 'freeze'].includes(action) && !reason) return res.status(400).json({ error: 'Укажите причину ограничения' });
            const u = users[login];
            if (action === 'freeze' && u.registrationStatus === 'banned') return res.status(409).json({ error: 'Сначала разблокируйте аккаунт' });
            if (action === 'unban' && u.registrationStatus !== 'banned') return res.status(409).json({ error: 'Аккаунт не заблокирован' });
            if (action === 'unfreeze' && !(u.frozenUntil > now())) return res.status(409).json({ error: 'Аккаунт не заморожен' });
            if (action === 'ban') { u.statusBeforeBan = u.registrationStatus === 'banned' ? u.statusBeforeBan : u.registrationStatus || 'confirmed'; u.registrationStatus = 'banned'; u.frozenUntil = null; }
            if (action === 'unban') { u.registrationStatus = u.statusBeforeBan === 'pending' ? 'pending' : 'confirmed'; delete u.statusBeforeBan; }
            if (action === 'freeze') u.frozenUntil = now() + Math.ceil(hours * 3600000);
            if (action === 'unfreeze') u.frozenUntil = null;
            if (['ban', 'freeze'].includes(action)) u.launcherVersion = (u.launcherVersion || 0) + 1;
            u.moderationReason = ['ban', 'freeze'].includes(action) ? reason : '';
            saveUsers();
            audit(req, login, 'moderation', action, { actor: req.user.login, reason, target: u.frozenUntil ? new Date(u.frozenUntil).toISOString() : 'launcher' });
            res.json({ success: true, player: profile(login) });
        });
        function internalRequired(req, res, next) {
            const expected = process.env.PLAYER_EVENTS_SECRET || '';
            const actual = req.get('X-Events-Secret') || '';
            const hash = s => crypto.createHash('sha256').update(s).digest();
            if (expected.length < 32 || !crypto.timingSafeEqual(hash(actual), hash(expected))) return res.status(401).json({ error: 'Unauthorized' });
            next();
        }
        app.post('/api/internal/server-events', internalRequired, (req, res) => {
            const { login, nickname, action, ip, server } = req.body;
            const matches = login ? (own(users, login) ? [[login, users[login]]] : []) : Object.entries(users).filter(([, u]) => typeof nickname === 'string' && u.nickname?.toLowerCase() === nickname.toLowerCase());
            if (matches.length !== 1) return res.status(404).json({ error: 'Укажите однозначный логин или никнейм игрока' });
            if (!['connect', 'disconnect', 'connection_denied'].includes(action) || typeof ip !== 'string' || !net.isIP(ip) || typeof server !== 'string' || !server.trim() || server.length > 200)
                return res.status(400).json({ error: 'Нужны action, IP игрока и адрес server' });
            const event = audit(req, matches[0][0], 'connections', action, { source: 'minecraft', userAgent: '', ip, target: server, outcome: action === 'connection_denied' ? 'denied' : 'success', reason: text(req.body.reason) });
            res.status(201).json({ success: true, id: event.id });
        });
        // Discord's existing/future bot supplies verified events; browsers cannot invent them.
        app.post('/api/internal/discord-events', internalRequired, (req, res) => {
            const { login, action, discordId, ip, bot } = req.body;
            if (!own(users, login)) return res.status(404).json({ error: 'Игрок не найден' });
            if (!['login', 'logout', 'discord_linked', 'discord_unlinked'].includes(action) || typeof discordId !== 'string' || !/^\d{1,25}$/.test(discordId) || typeof ip !== 'string' || (ip !== '' && !net.isIP(ip)) || typeof bot !== 'string' || !bot.trim() || bot.length > 64)
                return res.status(400).json({ error: 'Нужны action, discordId, bot и IP игрока (или пустая строка, если неизвестен)' });
            if (req.body.destination !== undefined && !['website', 'launcher', 'discord'].includes(req.body.destination)) return res.status(400).json({ error: 'Некорректное назначение входа' });
            const observedUsername = text(req.body.username, 64) || users[login].discordUsername || '';
            if (action === 'discord_linked') {
                if (Object.entries(users).some(([key, u]) => key !== login && String(u.discordId) === discordId)) return res.status(409).json({ error: 'Discord уже привязан к другому аккаунту' });
                if (users[login].discordId != null && String(users[login].discordId) !== discordId) return res.status(409).json({ error: 'Сначала отвяжите текущий Discord' });
                users[login].discordId = discordId; saveUsers();
            } else {
                if (String(users[login].discordId) !== discordId) return res.status(409).json({ error: 'Discord не привязан к этому аккаунту' });
                if (action === 'discord_unlinked') { delete users[login].discordId; delete users[login].discordUsername; saveUsers(); }
            }
            const username = observedUsername;
            if (username && action !== 'discord_unlinked') { users[login].discordUsername = username; saveUsers(); }
            const event = audit(req, login, action.startsWith('discord_') ? 'account' : 'auth', action, { source: 'discord', userAgent: '', method: 'bot', bot, discordId, discordUsername: username, ip, target: req.body.destination || 'discord' });
            res.status(201).json({ success: true, id: event.id });
        });
        return { adminRequired };
    }
    return { role, restriction, profile, audit, install, recent };
}
module.exports = { createPlayerServices };
