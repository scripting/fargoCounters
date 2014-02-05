var myVersion = "0.46";

var http = require ("http");
var AWS = require ("aws-sdk");
var s3 = new AWS.S3 ();
var urlpack = require ("url");
var dns = require ("dns");

var myPort, flRunningOnHeroku = false;

function consoleLog (s) {
	if (flRunningOnHeroku) { //they include the time in their console, no need to repeat
		console.log (s);
		}
	else {
		console.log (new Date ().toLocaleTimeString () + " -- " + s);
		}
	}
function tcpGetMyIpAddress () {
	var interfaces = require ("os").networkInterfaces ();
	for (var devName in interfaces) {
		var iface = interfaces [devName];
		for (var i = 0; i < iface.length; i++) {
			var alias = iface [i];
			if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
				return (alias.address);
				}
		}
	return ("0.0.0.0");
	}
function isAlpha (ch) {
	return (((ch >= 'a') && (ch <= 'z')) || ((ch >= 'A') && (ch <= 'Z')));
	}
function isNumeric (ch) {
	return ((ch >= '0') && (ch <= '9'));
	}
function sameDay (d1, d2) { 
	//returns true if the two dates are on the same day
	d1 = new Date (d1);
	d2 = new Date (d2);
	return ((d1.getFullYear () == d2.getFullYear ()) && (d1.getMonth () == d2.getMonth ()) && (d1.getDate () == d2.getDate ()));
	}
function padWithZeros (num, ctplaces) { 
	var s = num.toString ();
	while (s.length < ctplaces) {
		s = "0" + s;
		}
	return (s);
	}
function getDatePath (theDate, flLastSeparator) {
	if (theDate == undefined) {
		theDate = new Date ();
		}
	if (flLastSeparator == undefined) {
		flLastSeparator = true;
		}
	
	var month = padWithZeros (theDate.getMonth () + 1, 2);
	var day = padWithZeros (theDate.getDate (), 2);
	var year = theDate.getFullYear ();
	
	if (flLastSeparator) {
		return (year + "/" + month + "/" + day + "/");
		}
	else {
		return (year + "/" + month + "/" + day);
		}
	}
function cleanName (name) {
	var s = "";
	if (name == undefined) {
		return ("");
		}
	for (var i = 0; i < name.length; i++) {
		var ch = name [i];
		if (isAlpha (ch) || isNumeric (ch)) {
			s += ch;
			}
		}
	return (s.toLowerCase (s));
	}
function okparam (param) {
	return ((param != undefined) && (param.length > 0));
	}
function s3SplitPath (path) { //split path like this: /tmp.scripting.com/testing/one.txt -- into bucketname and path.
	var bucketname = "";
	if (path.length > 0) {
		if (path [0] == "/") { //delete the slash
			path = path.substr (1); 
			}
		var ix = path.indexOf ("/");
		bucketname = path.substr (0, ix);
		path = path.substr (ix + 1);
		}
	return ({Bucket: bucketname, Key: path});
	}
function s3GetObject (path, callback) {
	var params = s3SplitPath (path);
	s3.getObject (params, function (err, data) {
		callback (data);
		});
	}
function s3NewObject (path, data, type, acl, callback) {
	var splitpath = s3SplitPath (path);
	if (type == undefined) {
		type = s3defaultType;
		}
	if (acl == undefined) {
		acl = s3defaultAcl;
		}
	var params = {
		ACL: acl,
		ContentType: type,
		Body: data,
		Bucket: splitpath.Bucket,
		Key: splitpath.Key
		};
	s3.putObject (params, function (err, data) { 
		if (callback != undefined) {
			callback (err, data);
			}
		});
	}
function s3getJsonObject (path, callback) {
	s3GetObject (path, function (data) {
		if (data == null) {
			callback (new Object ());
			}
		else {
			callback (JSON.parse (data.Body));
			}
		});
	}
function s3putJsonObject (path, obj, callback) {
	var jsontext = JSON.stringify (obj, undefined, 3);
	s3NewObject (path, jsontext, "text/plain", "public-read", function (err, data) {
		if (err != null) {
			consoleLog ("s3putJsonObject: error: " + err.message);
			}
		else {
			if (callback != undefined) {
				callback (err, data);
				}
			}
		});
	}

var myIpAddress = tcpGetMyIpAddress ();
var myServerName = process.env.counterServerName;

if (myServerName == undefined) {
	myServerName = myIpAddress;
	}

var s3appPath = "/static.scripting.com/counters/";

var s3folderpath = s3appPath + myServerName + "/";


var server = http.createServer (function (httpRequest, httpResponse) {
	var parsedUrl = urlpack.parse (httpRequest.url, true);
	
	consoleLog (httpRequest.url);
	
	switch (parsedUrl.pathname.toLowerCase ()) {
		case "/version":
			httpResponse.writeHead (200, {"Content-Type": "text/plain"});
			httpResponse.end (myVersion);    
			return;
		case "/counter":
			var url = parsedUrl.query.referer, now = new Date ();
			
			if (okparam (url) && okparam (parsedUrl.query.group)) {
				var group = cleanName (parsedUrl.query.group);
				var s3groupPath = s3appPath + group + "/";
				var s3todayPath = s3groupPath + "today.json";
				var s3archivePath = s3groupPath + getDatePath (now, false) + ".json";
				s3getJsonObject (s3todayPath, function (obj) {
					var lowerurl = url.toLowerCase ();
					
					//stats
						if (obj.ctUpdates == undefined) {
							obj.ctUpdates = 0;
							}
						if (obj.ctUpdatesToday == undefined) {
							obj.ctUpdatesToday = 0;
							}
						obj.ctUpdates++;
						obj.ctUpdatesToday++;
					//date rollover
						var nowstring = now.toUTCString ();
						if (obj.theDate == undefined) {
							obj.theDate = nowstring;
							}
						else {
							if (!sameDay (obj.theDate, now)) {
								obj = new Object (); 
								obj.theDate = nowstring;
								obj.ctUpdatesToday = 0;
								consoleLog ("Rollover.");
								}
							}
						obj.whenLastUpdate = nowstring;
					
					if (obj.urls == undefined) {
						obj.urls = new Array ();
						}
					var flfound = false, len = obj.urls.length; 
					for (var i = 0; i < len; i++) {
						if (obj.urls [i].url == url) {
							obj.urls [i].ct++;
							flfound = true;
							break;
							}
						}
					if (!flfound) {
						var newobj = new Object ();
						newobj.ct = 1;
						newobj.url = url;
						obj.urls [len] = newobj;
						}
					
					
					
					
					consoleLog ("Counter: referrer == " + url);
					
					s3putJsonObject (s3todayPath, obj, function (err, data) {
						s3putJsonObject (s3archivePath, obj);
						});
					});
				}
			
			//set up the http response
				httpResponse.writeHead (200, {"Content-Type": "application/json"});
				var x = {"message": "We got your ping on " + now};
				var s = "getData (" + JSON.stringify (x) + ")";
				httpResponse.end (s);    
			
			return
		}
	});


if (process.env.PORT == undefined) { //it's not Heroku
	if (process.env.fpServerPort == undefined) {
		myPort = 5337;
		}
	else {
		myPort = process.env.fpServerPort;
		}
	}
else {
	myPort = process.env.PORT;
	flRunningOnHeroku = true;
	}

consoleLog ("Counter server v" + myVersion + " running on port " + myPort + ".");

server.listen (myPort);
