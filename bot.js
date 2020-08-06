"use strict";
var Discord = require('discord.io');
var XMLHttpRequest  = require('xmlhttprequest').XMLHttpRequest;
var logger = require('winston');
var fs = require('fs');
var auth = require('./auth.json');
var current = {};
var cooldowns = {};
var allCoins = [];
var allTimeouts = [];
var numServersIn = 0;
var sleeping = false;

const { Client, ClientPresence, MessageCollector, Util } = require('discord.js');
const { TOKEN, PREFIX } = require('./config');
const client = new Client();

function calcOffset() {
	var offset = 0;
    var xmlhttp = new XMLHttpRequest();
    xmlhttp.open("HEAD", "http://www.googleapis.com", false);
    xmlhttp.send();

    var dateStr = xmlhttp.getResponseHeader('Date');
    var serverTimeMillisGMT = Date.parse(new Date(Date.parse(dateStr)).toUTCString());
    var localMillisUTC = new Date().getTime();

	offset = serverTimeMillisGMT - localMillisUTC;
    return offset;
}

function getServerTime() {
    var date = new Date();
    date.setTime(date.getTime() + calcOffset());
    return date;
}

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
	colorize: true
});
logger.level = 'info';

// Initialize Discord Bot
logger.info('Establishing a connection to Discord...');
client.login(TOKEN);
client.on('warn', (w) => logger.warn(w));
client.on('error', (e) => logger.error(e));
client.on('disconnect', () => logger.info('Bot is disconnected!'));
client.on('reconnecting', () => logger.info('Bot is now reconnecting'));
client.on('ready', () => {
	logger.info('Established a connection to Discord');
	updatePresence();
	logger.info('Preconnecting to time server...');
	var dif = calcOffset();
	logger.info('Connected to time server. Offset of ' + dif + ' ms');
	
	logger.info('Getting all current coins...');
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			allCoins = JSON.parse(xhttp.responseText);
			logger.info('Successfully got list of coins!');
			logger.info('Registering message intervals...');
			fs.readFile('subs.json', function(err, data) {
				var errors = 0;
				data = JSON.parse(data);
				for (var s = 0; s < data.length; s++) {
					try {
						allTimeouts.push(client.setInterval(getInfo, data[s].interval, data[s].coinID, client.channels.cache.get(data[s].channel), null, client.guilds.cache.get(data[s].guild)));
						getInfo(data[s].coinID, client.channels.cache.get(data[s].channel), null, client.guilds.cache.get(data[s].guild));
					} catch (e) {
						errors++;
					}
				}
				logger.info('Registered ' + (data.length - errors) + ' subscriptions with ' + errors + ' errors');
				logger.info('CryptoBot is ready.');
			});
		} else if (this.readyState == 4 && (this.status >= 500)) {
			logger.warn('Could not get list of coins! Error' + this.status + '. Waiting for 1 minute to re-request...');
			client.setTimeout(xhttp.send, 60000);
		} else if (this.readyState == 4 && (this.status < 500 || this.status >= 300)) {
			logger.error('Could not get list of coins! Error ' + this.status + '! Halting!');
			client.destroy();
		}
	};
	xhttp.open("GET", "https://api.coingecko.com/api/v3/coins/list", true);
	xhttp.send();
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
	var ping = (msg.createdAt.getTime() - getServerTime().getTime()) + client.ws.ping;
	
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
	var interval = args[2] ? args[2].toLowerCase() : '';

	switch(command) {
		case 'sub':
		case 'subscribe':
		case 'add':
			if (isDM) {
				msg.channel.send('To prevent overload, this feature is currently not available in DM\'s. Sorry for the inconvenience. If you\'d like to help fund the project, you can donate to me at https://aleef.dev :D');
				return;
			}
			
			if (allCoins == []) {
				msg.channel.send('The CoinGecko API is having issues right now. Please try again later.');
				return;
			}
			
			if (interval < 1 || interval > 168) {
				msg.channel.send('Please choose an interval between 1 hour and 1 week (168 hours)');
				return;
			}
			
			//Begin coin search
			if (coinSearch == null || coinSearch == "" || !isNaN(coinSearch)) {
				msg.channel.send('Please enter a coin to search after the command. Example: `|' + command + ' daps 1`');
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
					type(msg.channel, true);
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
						return;
					} else {
						longReplyMessage.delete();
						message.delete().catch(error => {
							logger.error(error);
						});
					}
					
					collector.stop();
			
					var dataToWrite;
					type(msg.channel, true);
					
					fs.readFile('subs.json', function(err, data) {
						dataToWrite = JSON.parse(data);
						for (var s = 0; s < dataToWrite.length; s++) {
							if (dataToWrite[s].coinID == coinFound && client.channels.cache.get(dataToWrite[s].channel).id == msg.channel.id) {
								type(msg.channel, false);
								msg.channel.send('This channel is already subscribed to `' + coinFound + '`');
								return;
							}
						}
						
						logger.info(coinFound);
						
						dataToWrite.push({
							coinID: coinFound,
							channel: msg.channel.id,
							guild: msg.guild.id,
							interval: (interval * 3600000)
						});
						
						fs.writeFile('subs.json', JSON.stringify(dataToWrite), function (error) {
							type(msg.channel, false);
							if (error) {
								logger.error(err);
								return;
							}
							
							var ss = interval > 1 ? 's' : '';
							
							client.setInterval(getInfo, (interval * 3600000), coinFound, msg.channel, null, msg.guild);
							
							type(msg.channel, false);
							msg.channel.send('I will now send updates on `' + coinFound + '` every ' + interval + ' hour' + ss + ' to this channel');
						});
					});
				});
			} else {
				coinFound = possibleCoins[0].id;
				
				var dataToWrite;
				type(msg.channel, true);
				
				fs.readFile('subs.json', function(err, data) {
					dataToWrite = JSON.parse(data);
					for (var s = 0; s < dataToWrite.length; s++) {
						if (dataToWrite[s].coinID == coinFound && client.channels.cache.get(dataToWrite[s].channel).id == msg.channel.id) {
							type(msg.channel, false);
							msg.channel.send('This channel is already subscribed to `' + coinFound + '`');
							return;
						}
					}
					
					logger.info(coinFound);
					
					dataToWrite.push({
						coinID: coinFound,
						channel: msg.channel.id,
						guild: msg.guild.id,
						interval: (interval * 3600000)
					});
					
					fs.writeFile('subs.json', JSON.stringify(dataToWrite), function (error) {
						if (error) {
							logger.error(err);
							return;
						}
						
						var ss = interval > 1 ? 's' : '';
						
						client.setInterval(getInfo, (interval * 3600000), coinFound, msg.channel, null, msg.guild);
						
						type(msg.channel, false);
						msg.channel.send('I will now send updates on `' + coinFound + '` every `' + interval + '` hour' + ss + ' to this channel');
					});
				});
			}
			// End coin search
			
			break;
			
		case 'unsub':
		case 'unsubscribe':
		case 'remove':
			if (isDM) {
				msg.channel.send('To prevent overload, this feature is currently not available in DM\'s. Sorry for the inconvenience. If you\'d like to help fund the project, you can donate to me at https://aleef.dev :D');
				return;
			}
			
			if (coinSearch == null || coinSearch == "" || !isNaN(coinSearch)) {
				msg.channel.send('Please enter a coin to remove after the command. Example: `|' + command + ' daps`');
				return;
			}
			
			var dataToWrite;
			type(msg.channel, true);
			
			fs.readFile('subs.json', function(err, data) {
				dataToWrite = JSON.parse(data);
				var found = -1;
				
				for (var s = 0; s < dataToWrite.length; s++) {
					if (dataToWrite[s].coinID == coinSearch && client.channels.cache.get(dataToWrite[s].channel).id == msg.channel.id) {
						found = s;
					}
				}
				
				if (found == -1) {
					var replyMultiple = 'Could not find a coin named `' + coinSearch + '` to unsubscribe from in this channel. Current channel subscriptions:```\n';
					for (var e = 0; e < dataToWrite.length; e++) {
						if (e == dataToWrite.length - 1) {
							replyMultiple += (dataToWrite[e].coinID + '```');
						} else {
							replyMultiple += (dataToWrite[e].coinID + '\n');
						}
					}
					
					type(msg.channel, false);
					msg.channel.send(replyMultiple);
					
					return;
				}
				
				dataToWrite.splice(found, found+1);
				
				fs.writeFile('subs.json', JSON.stringify(dataToWrite), function (error) {
					if (error) {
						logger.error(err);
						return;
					}
					
					client.clearInterval(allTimeouts[found]);
					allTimeouts.splice(found, found+1);
					
					type(msg.channel, false);
					msg.channel.send('I will no longer send updates on `' + coinSearch + '` to this channel');
				});
			});
			
			break;
			
		case 'current':
		case 'now':
		case 'price':
		case 'info':
			//I tried combining this command with add & remove, but the function would end before the event listener caught a reply. This would only be possible with async/await, but I believe that to be impossible because we are already inside of an event listener
			if (allCoins == []) {
				msg.channel.send('The CoinGecko API is having issues right now. Please try again later.');
				return;
			}
			
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
						getInfo(coinFound, msg.channel, msg.author, null);
					}
					
					collector.stop();
				});
			} else {
				getInfo(possibleCoins[0].id, msg.channel, msg.author, null);
			}
			
			break;
			
		case 'invite':
		case 'inv':
		case 'join':
		case 'link':
			msg.author.send('You can use this link to invite the CryptoBot to your server. Thank you for using CryptoBot!\nhttps://discord.com/api/oauth2/authorize?client_id=737464526013989044&permissions=8&scope=bot');
			break;
			
		case 'ping':
		case 'status':
			type(msg.channel, true);
			var xhttp = new XMLHttpRequest();
			var pingAPI;
			xhttp.onreadystatechange = function() {
				if (this.readyState == 4 && this.status == 200) {
					pingAPI = getServerTime().getTime() - pingAPI;
					type(msg.channel, false);
					msg.channel.send({
						embed: {
							"title": ":ping_pong: Pong!",
							"color": 6168410,
							"timestamp": new Date().toString(),
							"footer": {
								"icon_url": msg.author.avatarURL(),
								"text": msg.author.tag
							},
							"fields": [
								{
									"name": ":man_technologist: :arrow_right: <:wumpus:741033749483094066> :arrow_right: :robot:",
									"value": ping + " ms"
								}, {
									"name": ":robot: :arrow_right: <:wumpus:741033749483094066>",
									"value": client.ws.ping + " ms"
								}, {
									"name": ":robot: :arrow_left: :lizard:",
									"value": pingAPI + " ms"
								}
							]
						}
					});
				} else if (this.readyState == 4 && this.status != 200) {
					type(msg.channel, false);
					msg.channel.send({
						embed: {
							"title": ":ping_pong: Pong!",
							"color": 6168410,
							"timestamp": new Date().toString(),
							"footer": {
								"icon_url": msg.author.avatarURL(),
								"text": msg.author.tag
							},
							"fields": [
								{
									"name": ":man_technologist: :arrow_right: <:wumpus:741033749483094066> :arrow_right: :robot:",
									"value": ping + " ms"
								}, {
									"name": ":robot: :arrow_right: <:wumpus:741033749483094066>",
									"value": client.ws.ping + " ms"
								}, {
									"name": ":robot: :arrow_left: :lizard:",
									"value": "Failed! :no_entry_sign:"
								}
							]
						}
					});
				}
			};
			xhttp.open("GET", "https://api.coingecko.com/api/v3/ping", false);
			pingAPI = getServerTime().getTime();
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
							"name": "`invite/inv/join/link`",
							"value": "Get a link to invite the bot to your server"
						},
						{
							"name": "`ping/status`",
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

//Gets and posts a coin's current info
function getInfo(id, channel, requester, guild) {
	if (requester) {
		type(channel, true);
	}
	
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			if (requester) {
				type(channel, false);
			}
			var coin = JSON.parse(xhttp.responseText);
			channel.send({
				embed: {
					"title": coin.name,
					"description": (coin.sentiment_votes_up_percentage + "% 👍"),
					"url": coin.links.homepage[0],
					"color": 6168410,
					"timestamp": new Date().toString(),
					"footer": {
						"icon_url": requester ? requester.avatarURL() : guild.iconURL(),
						"text": requester ? requester.tag : guild.name
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