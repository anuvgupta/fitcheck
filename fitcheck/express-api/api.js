/* FITCHECK
 * API BACKEND
 * CVGT F21-BT-BUSINESS-ONLINE
 */

// backend server main


// imports
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const mongodb = require('mongodb');
const readline = require("readline");
const ejwt = require("express-jwt");
const jwt = require("jsonwebtoken");
const utils = require("./utils");


// environment
global.args = process.argv.slice(2);
global.env = global.args[0] == "--production" ? "prod" : "dev";
global.config = JSON.parse(fs.readFileSync('./config.json', { encoding: 'utf8', flag: 'r' }));
global.http_port = global.env == "dev" ? 8000 : global.config.http_port;
global.mongo_port = global.env == "dev" ? 27017 : global.config.mongo_port;

// mongodb api
var mongo_api = null;
var mongo_client = null;
var mongo_url = "mongodb://localhost:" + global.mongo_port;
// initialize mongodb client
function db_setup(next) {
    mongo_client = mongodb.MongoClient;
    mongo_client.connect(mongo_url, { useUnifiedTopology: true }, (e, client) => {
        if (e) console.err("[db]", "connection error", e.message ? e.message : e);
        else {
            console.log("[db]", "connected to", mongo_url);
            mongo_api = client.db(global.config.mongo_db_id);
            next();
        }
    });
}
// check authentication
function db_authenticate(username, password, resolve) {
    mongo_api.collection('user').findOne({
        username: username, password: password
    }, (e, item1) => {
        if (e) {
            console.err("[db]", `error in authentication for user ${username}`, e.message ? e.message : e);
            resolve(false, e);
        } else {
            if (item1 == null)
                resolve(null);
            else resolve(item1);
        }
    });
}
// check if user exists
function db_user_exists(username, resolve) {
    mongo_api.collection('user').findOne({
        username: username
    }, (e, item1) => {
        if (e) {
            console.err("[db]", `error finding user ${username}`, e.message ? e.message : e);
            resolve(false, e);
        } else {
            if (item1 == null)
                resolve(null);
            else resolve(item1);
        }
    });
}
// create new user
function db_create_user(username, new_password, resolve) {
    mongo_api.collection('user').insertOne({
        username: username,
        password: new_password,
        outfits: [],
        wardrobe: []
    }, (e, result1) => {
        if (e) {
            console.err("[db]", `error creating user with username ${username}`, e.message ? e.message : e);
            resolve(false, e);
        } else resolve(true, result1);
    });
}




// express web server
var express_api = null;
var http_server = null;
// initialize express web server
function web_setup() {
    express_api = express();
    // express_api.set('view engine', 'ejs');
    http_server = http.Server(express_api);
    express_api.use(express.json());
    express_api.use(express.urlencoded({ extended: true }));
    express_api.use(utils.web_cors);
    // express_api.use(express.static("static"));
    express_api.get("/", (req, res) => {
        res.status(200).end();
    });
    web_routing();
}
// run express web server
function web_start(next) {
    express_api.listen(global.http_port, _ => {
        console.log("[web]", "listening on", global.http_port);
        if (next) next();
    });
}
// respond to express web request with json data
function web_return_data(req, res, data) {
    res.status(200);
    res.setHeader('content-type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
    return null;
}
// respond to express web request with an http error (with json data)
function web_return_error(req, res, code, msg) {
    res.status(code);
    res.setHeader('content-type', 'application/json');
    res.send(JSON.stringify({
        status: code,
        message: msg
    }, null, 2));
}
// generate auth token
function web_issue_token(username) {
    return jwt.sign(
        { username: (`${username}`).trim() },
        global.config.jwt.secret,
        { algorithm: global.config.jwt.algo }
    );
}
// verify auth token
function web_verify_token(token) {
    var result = null;
    try {
        result = jwt.verify(token, global.config.jwt.secret);
    } catch (e) {
        console.log(`[web] error verifying token "${token}":`, (e.message ? e.message : e));
        result = null;
    }
    return result;
}
// verify auth token (express middleware)
function web_require_token() {
    return ejwt({
        secret: global.config.jwt.secret,
        algorithms: [global.config.jwt.algo]
    });
}
// attach express route events
function web_routing() {

    /* api */
    express_api.get("/api", (req, res) => {
        // base endpoint
        console.log("[web]", "hello world");
        res.send("FitCheck");
    });

    /* auth */
    // sign in
    express_api.post("/api/sign_in", (req, res) => {
        // validate input (username, password)
        if (!req.body.hasOwnProperty('username') || !req.body.hasOwnProperty('password'))
            return web_return_error(req, res, 400, "Missing username or password");
        if (!req.body.username || (`${req.body.username}`).trim().length < 2)
            return web_return_error(req, res, 400, "Invalid username (too short)");
        req.body.username = (`${req.body.username}`).trim();
        if (!utils.validateAlphanumeric(req.body.username))
            return web_return_error(req, res, 400, "Invalid username (letters/numbers only)");
        if (!req.body.password || (`${req.body.password}`).trim().length < 2)
            return web_return_error(req, res, 400, "Invalid password (too short)");
        // verify user exists
        db_user_exists(req.body.username, (result1, e1) => {
            if (result1 === null) return web_return_error(req, res, 500, "Database error");  // `Database error: ${e1.message ? e1.message : e1.toString()}`
            if (result1 == false) return web_return_error(req, res, 400, "User not found");
            // verify username+password
            db_auth(req.body.username, req.body.password, (result2, e2) => {
                if (result2 === null) return web_return_error(req, res, 500, "Database error");  //  `Database error: ${e2.message ? e2.message : e2.toString()}`
                if (result2 == false) return web_return_error(req, res, 401, "Incorrect password");
                // issue new token
                var token = web_issue_token(req.body.username);
                return web_return_data(req, res, { token: token });
            });
        });
    });
    // sign up
    express_api.post("/api/sign_up", (req, res) => {
        // validate input (new_username, new_password)
        if (!req.body.hasOwnProperty('new_username') || !req.body.hasOwnProperty('new_password'))
            return web_return_error(req, res, 400, "Missing new username or new password");
        if (!req.body.new_username || (`${req.body.new_username}`).trim().length < 2)
            return web_return_error(req, res, 400, "Invalid new username (too short)");
        req.body.new_username = (`${req.body.new_username}`).trim();
        if (!utils.validateAlphanumeric(req.body.new_username))
            return web_return_error(req, res, 400, "Invalid new username (letters/numbers only)");
        if (!req.body.new_password || (`${req.body.new_password}`).trim().length < 2)
            return web_return_error(req, res, 400, "Invalid new password (too short)");
        // verify user does not already exist
        db_user_exists(req.body.new_username, (result1) => {
            if (result1 === null) return web_return_error(req, res, 500, "Database error");
            if (result1 != false) return web_return_error(req, res, 400, "Username already taken");
            // create user with username+password
            db_create_user(req.body.new_username, req.body.new_password, (result2) => {
                if (result2 === null) return web_return_error(req, res, 500, "Database error");
                if (result2 == false) return web_return_error(req, res, 500, "Failed to create user");
                // issue new token
                var token = web_issue_token(req.body.new_username);
                return return_data(req, res, { token: token });
            });
        });
    });
    // authenticate token
    express_api.get("/api/auth", web_require_token() /* middleware decodes JWT */, (req, res) => {
        // verify decoded user exists
        db_user_exists(req.user.username, (result1) => {
            if (result1 === null) return web_return_error(req, res, 500, "Database error");
            if (result1 == false) return web_return_error(req, res, 400, "User not found");
            // authenticate user
            return return_data(req, res, { username: req.user.username });
        });
    });

    /* outfits */

    /* clothes */
}


// main method
function main() {
    console.log("FITCHECK");
    console.log("[main]", "backend initializing");
    // set up database
    db_setup(_ => {
        // set up web server
        web_setup();
        web_start(_ => {
            // ready
            console.log("[main]", "backend ready");
        });
    });
}


// entry point
main();