const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals: { GoalFollow, GoalBlock, GoalXZ, GoalNear } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3').Vec3;
const config = require('./settings.json');
const loggers = require('./logging.js');
const logger = loggers.logger;

// Function to clear the console
function clearConsole() {
    process.stdout.write('\x1Bc');
}

// Function to display the welcome message
function displayWelcomeMessage() {
    const welcomeMessage = `
\x1b[36m██████╗  ██╗   ██╗ ███████╗ ██╗  ██╗ ██╗   ██╗
\x1b[35m██╔══██╗ ██║   ██║ ██╔════╝ ██║ ██╔╝ ██║   ██║
\x1b[33m██████╔╝ ██║   ██║ █████╗   █████╔╝  ██║   ██║
\x1b[34m██╔═══╝  ██║   ██║ ██╔══╝   ██╔═██╗  ██║   ██║
\x1b[32m██║      ╚██████╔╝ ███████╗ ██║  ██╗ ╚██████╔╝
\x1b[31m╚═╝       ╚═════╝  ╚══════╝ ╚═╝  ╚═╝  ╚═════╝ 
`;

    const developedBy = `
\x1b[1mDeveloped by: \x1b[33mVALKA19\x1b[0m
\x1b[1mGitHub: \x1b[34mhttps://github.com/Valery-a\x1b[0m
`;

    console.log(welcomeMessage);
    console.log(developedBy);
}

// Function to start the loading animation
function startLoadingAnimation() {
    const spinnerChars = ['|', '/', '-', '\\'];
    let spinnerIndex = 0;

    const spinner = setInterval(() => {
        process.stdout.write(`\r${spinnerChars[spinnerIndex]} Initializing...`);
        spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
    }, 100);

    // Stop the spinner and show the welcome message after 2 seconds
    setTimeout(() => {
        clearInterval(spinner);
        clearConsole();
        displayWelcomeMessage();
    }, 2000);
}


function createBot() {
    const bot = mineflayer.createBot({
        username: config['bot-account']['username'],
        password: config['bot-account']['password'],
        auth: config['bot-account']['type'],
        host: config.server.ip,
        port: config.server.port,
        version: config.server.version,
    });

    bot.loadPlugin(pathfinder);
    initializeBot(bot);
}

function initializeBot(bot) {
    bot.once('spawn', () => {
        logger.info("Bot joined the server");
        if (config.utils['auto-auth'].enabled) {
            autoAuth(bot);
        }

        if (config.utils['player-follow'].enabled) {
            setTimeout(() => {
                followPlayer(bot);
            }, 1000);
        }

        if (config.utils['player-tracking'].enabled) {
            bot.on('physicsTick', () => lookAtNearestPlayer(bot));
            logger.info('Started looking at nearest player');
        }

        if (config.utils['chat-messages'].enabled) {
            chatMessages(bot);
        }

        if (config.position.enabled) {
            moveToPosition(bot);
        }

        if (config.utils['anti-afk'].enabled) {
            antiAfk(bot);
        }

        if (config.utils['tp-ask'].enabled) {
            setTimeout(() => {
                tpAsk(bot);
            }, 2000);
        }
        
        if (config.kaura.enabled) {
            killAura(bot);
        }
    });
    
    bot.on('chat', (username, message) => {
        if (config.utils['chat-log']) {
            logger.info(`<${username}> ${message}`);
        }
    });

    bot.on('goal_reached', () => {
        if (config.position.enabled) {
            logger.info(`Bot arrived at target location. ${bot.entity.position}`);
        }
    });

    bot.on('death', () => {
        logger.warn(`Bot has died at ${bot.entity.position}`);
        bot.once('spawn', () => {
            logger.info(`Bot has respawned at ${bot.entity.position}`);
            if (config.utils['player-follow'].enabled) {
                followPlayer(bot);
            }
        });
    });

    if (config.utils['auto-reconnect']) {
        bot.on('end', () => {
            setTimeout(() => {
                createBot();
            }, config.utils['auto-reconnect-delay']);
        });
    }

    bot.on('kicked', (reason) => {
        let reasonText = JSON.parse(reason).text;
        if (reasonText === '') {
            reasonText = JSON.parse(reason).extra[0].text;
        }
        reasonText = reasonText.replace(/§./g, '');
        logger.warn(`Bot was kicked from the server. Reason: ${reasonText}`);
    });

    bot.on('error', (err) => {
        logger.error(`${err.message}`);
    });
}

function tpAsk(bot) {
    const ownerName = config.admin.playerign;

    logger.info(`Sending teleport request to ${ownerName}`);
    bot.chat(`/tpa ${ownerName}`);

    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString();
        
        if (message.includes('has accepted your teleport request')) {
            logger.info(`Teleport request accepted by ${ownerName}`);
        }

        else if (message.includes('teleport request denied') || message.includes('request timed out')) {
            logger.warn(`Teleport request was denied or timed out for ${ownerName}`);
        }
    });
}

function autoAuth(bot) {
    logger.info('Started auto-auth module');
    const password = config.utils['auto-auth'].password;
    setTimeout(() => {
        bot.chat(`/register ${password} ${password}`);
        bot.chat(`/login ${password}`);
    }, 500);
    logger.info(`Authentication commands executed`);
}

function followPlayer(bot) {
    const username = config.admin.playerign;
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    function updatePlayer() {
        return bot.players[username]?.entity;
    }

    function startFollowing() {
        let playerEntity = updatePlayer();
        if (!playerEntity) {
            logger.warn(`Player ${username} not found or not in range`);
            return;
        }

        logger.info(`Found player ${username}, starting to follow`);
        const follow = new GoalFollow(playerEntity, 2);
        bot.pathfinder.setGoal(follow, true);
        logger.info(`Following ${username}`);

        bot.on('physicsTick', breakObstacles);
    }

    function breakObstacles() {
        const playerEntity = updatePlayer();
        if (!playerEntity) {
            bot.pathfinder.setGoal(null);
            return;
        }

        const playerPosition = playerEntity.position;
        const botPosition = bot.entity.position;
        const distance = botPosition.distanceTo(playerPosition);

        if (distance < 1) {
            bot.pathfinder.setGoal(null);
        } else if (!bot.pathfinder.goal) {
            const follow = new GoalFollow(playerEntity, 2);
            bot.pathfinder.setGoal(follow, true);
        }

        const blockInPath = bot.blockAt(botPosition.offset(0, 1, 0));
        if (blockInPath && blockInPath.boundingBox === 'block') {
            bot.dig(blockInPath, (err) => {
                if (err) {
                    logger.error(`Failed to break block: ${err.message}`);
                } else {
                    logger.info('Block broken to clear path');
                }
            });
        }
    }

    startFollowing();
}

function lookAtNearestPlayer(bot) {
    const playerFilter = (entity) => entity.type === 'player';
    const playerEntity = bot.nearestEntity(playerFilter);
    if (playerEntity) {
        const pos = playerEntity.position.offset(0, playerEntity.height, 0);
        bot.lookAt(pos);
    }
}

function chatMessages(bot) {
    logger.info('Started chat-messages module');
    const messages = config.utils['chat-messages']['messages'];

    if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;
        setInterval(() => {
            logger.info(`${messages[i]}`);
            i = (i + 1) % messages.length;
        }, delay * 1000);
    } else {
        messages.forEach((msg) => {
            logger.info(msg);
        });
    }
}

function killAura(bot) {
    const range = config.kaura.range || 5;
    const target = config.kaura.target || 'both';
    const attackDelay = config.kaura.attackDelay || 1000;
    if (!config.kaura.enabled) {
        return;
    }
    let attacking = false;

    function findAndAttack() {
        let entity = null;

        if (target === 'players' || target === 'both') {
            const playerFilter = (entity) => entity.type === 'player' && entity.position.distanceTo(bot.entity.position) <= range;
            entity = bot.nearestEntity(playerFilter);
        }

        if (!entity && (target === 'mobs' || target === 'both')) {
            const mobFilter = (entity) => (entity.type === 'mob' || entity.type === 'hostile') && entity.position.distanceTo(bot.entity.position) <= range;
            entity = bot.nearestEntity(mobFilter);
        }

        if (entity && !attacking) {
            attacking = true;
            bot.setControlState('jump', true);
            setTimeout(() => {
                bot.setControlState('jump', false);
                setTimeout(() => {
                    bot.attack(entity, true);
                    logger.info(`Attacking entity: ${entity.name} at ${entity.position}`);
                    attacking = false;
                }, 300);
            }, 200);
        }
    }

    bot.removeListener('physicsTick', findAndAttack);
    bot.on('physicsTick', findAndAttack);
}


function moveToPosition(bot) {
    const pos = config.position;
    logger.info(`Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})`);
    bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
}

function antiAfk(bot) {
    if (config.utils['anti-afk'].sneak) {
        bot.setControlState('sneak', true);
    }

    if (config.utils['anti-afk'].jump) {
        bot.setControlState('jump', true);
    }

    if (config.utils['anti-afk']['hit'].enabled) {
        const delay = config.utils['anti-afk']['hit']['delay'];
        const attackMobs = config.utils['anti-afk']['hit']['attack-mobs'];

        setInterval(() => {
            if (attackMobs) {
                const entity = bot.nearestEntity(e => e.type !== 'object' && e.type !== 'player' && e.type !== 'global' && e.type !== 'orb' && e.type !== 'other');
                if (entity) {
                    bot.attack(entity);
                    return;
                }
            }
            bot.swingArm("right", true);
        }, delay);
    }

    if (config.utils['anti-afk'].rotate) {
        setInterval(() => {
            bot.look(bot.entity.yaw + 1, bot.entity.pitch, true);
        }, 100);
    }

    if (config.utils['anti-afk']['circle-walk'].enabled) {
        const radius = config.utils['anti-afk']['circle-walk']['radius'];
        circleWalk(bot, radius);
    }
}

function circleWalk(bot, radius) {
    const pos = bot.entity.position;
    const points = [
        [pos.x + radius, pos.y, pos.z],
        [pos.x, pos.y, pos.z + radius],
        [pos.x - radius, pos.y, pos.z],
        [pos.x, pos.y, pos.z - radius],
    ];
    let i = 0;
    setInterval(() => {
        if (i === points.length) i = 0;
        bot.pathfinder.setGoal(new GoalXZ(points[i][0], points[i][2]));
        i++;
    }, 1000);
}


createBot();

