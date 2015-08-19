var express = require("express");
var cookieParser = require("cookie-parser");
var bodyParser = require("body-parser");

module.exports = function(port, db, githubAuthoriser) {
    var app = express();

    app.use(express.static("public"));
    app.use(cookieParser());

    var users = db.collection("users");
    var conversations = db.collection("conversations-wpferg");
    var sessions = {};

    app.use(bodyParser.json());

    app.get("/oauth", function(req, res) {
        githubAuthoriser.authorise(req, function(githubUser, token) {
            if (githubUser) {
                users.findOne({
                    _id: githubUser.login
                }, function(err, user) {
                    if (!user) {
                        // TODO: Wait for this operation to complete
                        users.insertOne({
                            _id: githubUser.login,
                            name: githubUser.name,
                            avatarUrl: githubUser.avatar_url
                        });
                    }
                    sessions[token] = {
                        user: githubUser.login
                    };
                    res.cookie("sessionToken", token);
                    res.header("Location", "/");
                    res.sendStatus(302);
                });
            }
            else {
                res.sendStatus(400);
            }

        });
    });

    app.get("/api/oauth/uri", function(req, res) {
        res.json({
            uri: githubAuthoriser.oAuthUri
        });
    });

    app.use(function(req, res, next) {
        if (req.cookies.sessionToken) {
            req.session = sessions[req.cookies.sessionToken];
            if (req.session) {
                next();
            } else {
                res.sendStatus(401);
            }
        } else {
            res.sendStatus(401);
        }
    });

    app.get("/api/user", function(req, res) {
        users.findOne({
            _id: req.session.user
        }, function(err, user) {
            if (!err) {
                res.json(user);
            } else {
                res.sendStatus(500);
            }
        });
    });

    app.get("/api/users", function(req, res) {
        users.find().toArray(function(err, docs) {
            if (!err) {
                res.json(docs.map(function(user) {
                    return {
                        id: user._id,
                        name: user.name,
                        avatarUrl: user.avatarUrl
                    };
                }));
            } else {
                res.sendStatus(500);
            }
        });
    });

    app.get("/api/conversations", function(req, res) {
        conversations.find({
            between: req.session.user
        }).toArray(function (err, docs) {
            if (!err) {
                var usersDiscovered = [];
                var chats = [];

                docs.forEach(function (message) {

                    var messageFrom = message.between[0];
                    var messageSentByThisUser = messageFrom === req.session.user;
                    var chat;

                    var user = message.between.filter(function (user) {
                        return user !== req.session.user;
                    })[0];

                    if (usersDiscovered.indexOf(user) === -1) {

                        chat = {
                            user: user,
                            lastMessage: message.sent
                        };

                        if (messageSentByThisUser) {
                            chat.anyUnseen = false;
                        } else {
                            chat.anyUnseen = message.seen ? false : true;
                        }

                        usersDiscovered.push(user);
                        chats.push(chat);
                    } else {
                        chat = chats[usersDiscovered.indexOf(user)];

                        if (chat.lastMessage < message.sent) {
                            chat.lastMessage = message.sent;
                            if (messageSentByThisUser) {
                                chat.anyUnseen = false;
                            } else {
                                chat.anyUnseen = message.seen ? false : true;
                            }
                        }
                    }
                });

                res.json(chats);
            } else {
                res.sendStatus(500);
            }
        });
    });

    app.post("/api/conversations/:userId", function(req, res) {
        var toUserId = req.params.userId;
        var fromUserId = req.session.user;
        var message = {
            sent: req.body.sent,
            body: req.body.body,
            seen: false
        };
        if (toUserId && fromUserId && message.sent && message.body) {
            message.between = [fromUserId, toUserId];
            conversations.insert(message, {}, function(err, docs) {
                if (err) {
                    res.sendStatus(500);
                } else {
                    res.sendStatus(200);
                }
            });
        } else {
            res.sendStatus(401);
        }
    });

    app.get("/api/conversations/:userId", function(req, res) {
        var toUserId = req.params.userId;
        var fromUserId = req.session.user;

        conversations.find({
            between: {
                $all: [toUserId, fromUserId]
            }
        }).toArray(function (err, docs) {
            if (err) {
                res.sendStatus(500);
            } else {
                docs = docs.sort({sent: -1});
                res.json(docs.map(function (message) {
                    return {
                        from: message.between[0],
                        sent: message.sent,
                        body: message.body,
                        seen: message.seen || false
                    };
                }));

                // Mark as seen
                conversations.update({
                    between: [toUserId, fromUserId]
                }, {
                    $set: {
                        seen: true
                    }
                }, {multi: true});
            }
        });
    });

    return app.listen(port);
};
