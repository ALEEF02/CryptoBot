var Discord = require('discord.io');
var XMLHttpRequest  = require('xmlhttprequest').XMLHttpRequest;
var logger = require('winston');
var auth = require('./auth.json');
var current = {};
var cooldowns = {};
var allCoins = [];
var numServersIn = 0;
var sleeping = false;

const { Client, ClientPresence, MessageCollector, Util } = require('discord.js');
const { TOKEN, PREFIX } = require('./config');
const client = new Client();

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
	colorize: true
});
logger.level = 'info';

// Initialize Discord Bot
client.login(TOKEN);
client.on('warn', logger.warn);
client.on('error', logger.error);
client.on('disconnect', () => logger.info('Bot is disconnected!'));
client.on('reconnecting', () => logger.info('Bot is now reconnecting'));
client.on('ready', () => {
	updatePresence();
	logger.info('Getting all current coins...');
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
		   allCoins = JSON.parse(xhttp.responseText);
		   logger.info('Successfully got list of coins!');
		}
		
		if (this.readyState == 4 && (this.status < 200 || this.status >= 300)) {
			logger.warn('Could not get list of coins!');
		}
	};
	xhttp.open("GET", "https://api.coingecko.com/api/v3/coins/list", true);
	xhttp.send();
	logger.info('CryptoBot is ready. Registering message intervals...');
});
//Update the server count each time we join or leave a server
client.on('guildCreate', () => {updatePresence()});
client.on('guildDelete', () => {updatePresence()});

function updatePresence() {
	logger.info("Bot either joined or left a server. Previously in " + numServersIn + " servers, now in " + client.guilds.cache.array().length + " servers");
	numServersIn = client.guilds.cache.array().length;
	client.user.setPresence({
		activity: {
			name: ('on ' + numServersIn + ' servers'),
			url: 'https://www.coingecko.com/',
			type: 3
		},
		status: 'online',
	});
}

client.on('message', msg => {
	if (msg.author.bot) return undefined;
	if (!msg.content.startsWith(PREFIX)) return undefined;
	var ping = new Date(msg.createdTimestamp).getTime() - new Date().getTime();
	
	var ms = new Date().getTime();
	
	let command = msg.content.toLowerCase().split(' ')[0].slice(PREFIX.length);
	
	if (sleeping && command != 'wake') return undefined;
	
	var userID = msg.author.id;
	var isDM = msg.guild ? false : true;
	var since = ms - cooldowns[userID];
	var myMessageID;

	if (cooldowns[userID] == null) {
		cooldowns[userID] = ms;
		//Replace 0 with ms below for throttle time
	} else if (since < 0) {
		msg.channel.send(
		'<@' + userID + '> Wait ' + (Math.round((since) / 1000)) + ' second(s) before using another command'
		).then(message => {
			myMessageID = message.id;
			cooldowns[userID] = ms;
			return clearMessage(msg, message);
		});
	}

	const args = msg.content.toLowerCase().split(' ');
	const coinSearch = args[1] ? args[1].toLowerCase() : '';
	const url = args[1] ? args[1].replace(/<(.+)>/g, '$1') : '';

	switch(command) {
		case 'sub':
		case 'subscribe':
		case 'add':
			if (isDM) {
				msg.channel.send('To prevent overload, this feature is currently not available in DM\'s. Sorry for the inconvenience. If you\'d like to help fund the project, you can donate to me at https://aleef.dev :D');
				return;
			}
			
			msg.channel.send('This command is currently in the works. Please check back later.');
			break;
			
		case 'unsub':
		case 'unsubscribe':
		case 'remove':
			if (isDM) {
				msg.channel.send('To prevent overload, this feature is currently not available in DM\'s. Sorry for the inconvenience. If you\'d like to help fund the project, you can donate to me at https://aleef.dev :D');
				return;
			}
			
			msg.channel.send('This command is currently in the works. Please check back later.');
			break;
			
		case 'current':
		case 'now':
		case 'price':
		case 'info':
			if (coinSearch == null || coinSearch == "") {
				msg.channel.send('Please enter a coin to search after the command. Example: `|' + command + ' daps`');
				return;
			}
		
			type(msg.channel, true);
			msg.channel.send('Searching for coin...').then(message => {
				return clearMessage(null, message);
			});
			
			var coinFound;
			var possibleCoins = [];
			
			for (var i = 0; i < allCoins.length; i++) {
				if (allCoins[i].symbol.includes(coinSearch) || allCoins[i].name.toLowerCase().includes(coinSearch) || allCoins[i].id.toLowerCase().includes(coinSearch)) {
					possibleCoins.push(allCoins[i]);
				}
			}
			
			type(msg.channel, false);
			
			if (possibleCoins.length == 0) {
				msg.channel.send('Could not find a coin or token of that name! Please try refining your search');
				return;
			} else if (possibleCoins.length >= 2) {
				var replyMultiple = 'Found multiple coins with that name. Please reply with one of the following coins.```';
				for (var e = 0; e < possibleCoins.length; e++) {
					if (e == possibleCoins.length - 1) {
						replyMultiple += (possibleCoins[e].symbol + '```');
					} else {
						replyMultiple += (possibleCoins[e].symbol + '\n');
					}
				}
				
				var longReplyMessage;
				
				msg.channel.send(replyMultiple).then(message => {
					longReplyMessage = message;
				});
				
				const collector = new MessageCollector(msg.channel, m => m.author.id === msg.author.id);
				collector.on('collect', message => {
					var reply = message.content;
					if (message.content.startsWith(PREFIX)) {
						reply = message.content.toLowerCase().split(' ')[0].slice(PREFIX.length);
					}
					
					for (var u = 0; u < possibleCoins.length; u++) {
						if (reply.toLowerCase() == possibleCoins[u].symbol) {
							coinFound = possibleCoins[u].id;
							u = possibleCoins.length;
						}
					}
					
					if (coinFound == null) {
						msg.channel.send('Could not find a coin or token of that name! Please try refining your search');
					} else {
						longReplyMessage.delete();
						message.delete().catch(error => {
							logger.error(error);
						});
						getInfo(coinFound, msg.channel, msg.author);
					}
					
					collector.stop();
				});
			} else {
				getInfo(possibleCoins[0].id, msg.channel, msg.author);
			}
			
			break;
			
		case 'invite':
			msg.author.send('You can use this link to invite the CryptoBot to your server. Thank you for using CryptoBot!\nhttps://discord.com/api/oauth2/authorize?client_id=737464526013989044&permissions=8&scope=bot');
			break;
			
		case 'ping':
			type(msg.channel, true);
			var xhttp = new XMLHttpRequest();
			var pingAPI;
			xhttp.onreadystatechange = function() {
				if (this.readyState == 4 && this.status == 200) {
					pingAPI = new Date().getTime() - pingAPI;
					type(msg.channel, false);
					msg.channel.send({
						embed: {
							"title": ":ping_pong: Pong!",
							"color": 6168410,
							"timestamp": new Date().toString(),
							"fields": [
								{
									"name": ":man_technologist: :arrow_right: :desktop:  ",
									"value": ping + "ms",
									"inline": true
								},
								{
									"name": ":desktop: :arrow_left: :lizard:",
									"value": pingAPI + "ms",
									"inline": true
								}
							]
						}
					});
				}
			};
			xhttp.open("GET", "https://api.coingecko.com/api/v3/ping", false);
			pingAPI = new Date().getTime();
			xhttp.send();
			break;
			
		case 'help':
		case 'h':
		case '?':
			msg.channel.send({
				embed: {
					"title": "CryptoBot Help",
					"description": "Prefix `|` (Shift + Backslash)",
					"color": 6168410,
					"thumbnail": {
						"url": "https://cdn.discordapp.com/avatars/737464526013989044/c42034914af65feb7bc6533017c843e7.png"
					},
					"fields": [
						{
							"name": "`sub/subscribe/add [coinname] [interval in hours]`",
							"value": "Subscribe to price updates in the current channel"
						},
						{
							"name": "`unsub/unsubscribe/remove [coinname]`",
							"value": "Unsubscribe to price updates in the current channel"
						},						
						{
							"name": "`current/now/price/info [coinname]`",
							"value": "Get current information on a certain coin"
						},
						{
							"name": "`invite`",
							"value": "Get a link to invite the bot to your server"
						},
						{
							"name": "`ping`",
							"value": "Check the bot's ping"
						},
						{
							"name": "`help/h/?`",
							"value": "Displays this message"
						}
					]
				}
			});
			break;
			
		case 'shutdown':
			if (userID == '222916536300470272') {
				msg.channel.send('Shutting down...').then(m => {
					client.destroy();
				});
			}
			break;
			
		case 'sleep':
			if (userID == '222916536300470272') {
				sleeping = true;
				msg.channel.send('Will now ignore all incoming messages...');
			}
			break;
			
		case 'wake':
			if (userID == '222916536300470272') {
				sleeping = false;
				msg.channel.send('Will now begin responding to messages...');
			}
			break;
	}

	return undefined;
});

function clearMessage(message, myMessage) {
	setTimeout(function() {
		if (message) {
			message.delete();
		}
		if (myMessage) {
			myMessage.delete();
		}
	}, 3000);
};

function type(channel, typeStatus) {
	if (typeStatus) {
		channel.startTyping();
	} else {
		channel.stopTyping(true);
	}
	
	return true;
}

function numberWithCommas(x) {
    var parts = x.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
}

function getInfo(id, channel, requester) {
	type(channel, true);
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			type(channel, false);
			var coin = JSON.parse(xhttp.responseText);
			channel.send({
				embed: {
					"title": coin.name,
					"description": (coin.sentiment_votes_up_percentage + "% 👍"),
					"url": coin.links.homepage[0],
					"color": 6168410,
					"timestamp": new Date().toString(),
					"footer": {
						"icon_url": requester.avatarURL(),
						"text": requester.tag
					},
					"thumbnail": {
						"url": coin.image.large
					},
					"author": {
						"name": coin.id,
						"url": coin.links.blockchain_site[0],
						"icon_url": coin.image.large
					},
					"fields": [
						{
							"name": "Current Prices",
							"value": ("USD: $" + coin.market_data.current_price.usd + "\nEUR: €" + coin.market_data.current_price.eur + "\nBTC: " + coin.market_data.current_price.btc + "\nETH: " + coin.market_data.current_price.eth)
						},
						{
							"name": "Market Caps",
							"value": ("USD: $" + numberWithCommas(coin.market_data.market_cap.usd) + "\nEUR: €" + numberWithCommas(coin.market_data.market_cap.eur) + "\nBTC: " + numberWithCommas(coin.market_data.market_cap.btc) + "\nETH: " + numberWithCommas(coin.market_data.market_cap.eth))
						},
						{
							"name": "24 Hour High",
							"value": coin.market_data.high_24h.usd ? ("$" + numberWithCommas(coin.market_data.high_24h.usd)) : "Unknown",
							"inline": true
						},
						{
							"name": "24 Hour Low",
							"value": coin.market_data.low_24h.usd ? ("$" + numberWithCommas(coin.market_data.low_24h.usd)) : "Unknown",
							"inline": true
						}
					]
				}
			});
		}
	};
	xhttp.open("GET", "https://api.coingecko.com/api/v3/coins/" + id + "?localization=false&sparkline=false", true);
	xhttp.send();
}