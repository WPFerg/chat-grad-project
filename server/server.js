var express = require("express");
var cookieParser = require("cookie-parser");
var http = require("http");
var socketIo = require("socket.io");
var bodyParser = require("body-parser");

module.exports = function(port, db, githubAuthoriser) {
    var app = express();
    var server = http.Server(app);
    var io = socketIo(server);

    app.use(express.static("public"));
    app.use(cookieParser());

    var users = db.collection("users");
    var conversations = db.collection("conversations-wpferg2");
    var groups = db.collection("groups-wpferg");
    var sessions = {};
    var activeSockets = {};

    io.of("/realtime")
        .on("connection", function (socket) {
        var socketId;
        socket.on("userId", function (message) {
            socketId = message;
            activeSockets[socketId] = socket;
        });

        socket.on("disconnect", function () {
            delete activeSockets[socketId];
        });

        socket.on("message", function (message) {
            var to = message.to;
            delete message.to;
            saveMessage(socketId, to, message);
        });
    });

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
                    var indexOfThisUserInMessage;
                    var user;

                    if (message.groupId) {
                        user = message.groupId;
                        message.isGroup = true;
                    } else {
                        user = message.between.filter(function (user) {
                            return user !== req.session.user;
                        })[0];
                        message.isGroup = false;
                    }

                    if (usersDiscovered.indexOf(user) === -1) {

                        chat = {
                            user: user,
                            lastMessage: message.sent,
                            isGroup: message.isGroup
                        };

                        if (messageSentByThisUser) {
                            chat.anyUnseen = false;
                        } else {
                            indexOfThisUserInMessage = message.between.indexOf(req.session.user);
                            chat.anyUnseen = message.seen[indexOfThisUserInMessage - 1] ? false : true;
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
                                indexOfThisUserInMessage = message.between.indexOf(req.session.user);
                                chat.anyUnseen = message.seen[indexOfThisUserInMessage - 1] ? false : true;
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
            body: req.body.body
        };

        saveMessage(fromUserId, toUserId, message, res);
    });

    app.get("/api/conversations/:userId", function(req, res) {
        var toUserId = req.params.userId;
        var fromUserId = req.session.user;

        groups.findOne({_id: toUserId}, function(err, doc) {
            if (!err && doc && doc.users) {
                findByBetween(doc.users, toUserId);
            } else {
                findByBetween([toUserId, fromUserId], null);
            }
        });

        function findByBetween(between, groupId) {
            conversations.find({
                between:
                {
                    $all: between
                },
                groupId: groupId
            }).toArray(function (err, docs) {
                if (err) {
                    res.sendStatus(500);
                } else {
                    docs = docs.sort({sent: -1});
                    res.json(docs.map(function (message) {
                        return {
                            from: message.between[0],
                            between: message.between,
                            sent: message.sent,
                            body: message.body,
                            seen: message.seen
                        };
                    }));

                    // Mark as seen
                    docs.forEach(function (message) {
                        updateSeen(req.session.user, message);
                    });
                }
            });
        }
    });

    app.put("/api/groups/:groupId", function (req, res) {
        var groupObject = {
            _id: req.params.groupId,
            title: req.body.title,
            users: req.body.users
        };

        if (groupObject._id && groupObject.title && groupObject.users.length > 1) {
            groups.save(groupObject, function (err, result) {

                if (result.result.nModified) {
                    res.sendStatus(200);
                } else {
                    res.sendStatus(201);
                }
            });
        } else {
            res.sendStatus(400);
        }
    });

    app.get("/api/groups", function(req, res) {
        groups.find({
            users: req.session.user
        }).toArray(function (err, docs) {
            if (err) {
                res.sendStatus(500);
            } else {
                res.json(docs.map(function (group) {
                    return {
                        id: group._id,
                        title: group.title
                    };
                }));
            }
        });
    });

    function updateSeen(user, message) {
        var indexOfUserInBetween = message.between.indexOf(user);

        if (indexOfUserInBetween > 0 && !message.seen[indexOfUserInBetween - 1]) {
            message.seen[indexOfUserInBetween - 1] = true;
            conversations.update({
                between: message.between,
                sent: message.sent
            }, {
                $set: {
                    seen: message.seen
                }
            });
            pushSeenUpdate(message);
        }
    }

    function pushSeenUpdate(message) {
        message.between.forEach(function (user) {
            if (activeSockets[user]) {
                activeSockets[user].emit("message", {
                    from: message.between[0],
                    groupId: message.groupId,
                    between: message.between,
                    sent: message.sent,
                    body: message.body,
                    seen: message.seen
                });
            }
        });
    }

    function saveMessage(fromId, toId, message, res) {
        groups.findOne({_id: toId}, function(err, doc) {
            if (!err && doc && doc.users) {
                var usersExcludingCurrentUser = doc.users.filter(function (user) {
                    return user !== fromId;
                });
                message.between = [fromId].concat(usersExcludingCurrentUser);
                message.groupId = doc._id;
                send(res);
            } else if (!err) {
                message.between = [fromId, toId];
                send(res);
            } else {
                if (res) {
                    res.send(500);
                }
            }
        });

        function send(res) {
            populateSeen(message.between.length - 1);

            if (toId && fromId && message.sent && message.body) {
                conversations.insert(message, {}, function (err, docs) {
                    if (err) {
                        if (res) {
                            res.sendStatus(500);
                        }
                    } else {
                        if (res) {
                            res.sendStatus(200);
                        }
                        alertSocketListeners();
                    }
                });
            } else {
                if (res) {
                    res.sendStatus(401);
                }
            }
        }

        function populateSeen(numberOfParticipants) {
            message.seen = [];

            for (var i = 0; i < numberOfParticipants; i++) {
                message.seen.push(false);
            }
        }

        function alertSocketListeners() {
            var usersToAlert = message.between;
            usersToAlert.forEach(function (user) {
                if (activeSockets[user]) {
                    activeSockets[user].emit("message", {
                        from: message.between[0],
                        groupId: message.groupId,
                        between: message.between,
                        sent: message.sent,
                        body: message.body,
                        seen: message.seen
                    });
                    updateSeen(user, message);
                }
            });
        }
    }

    return server.listen(port);
};
