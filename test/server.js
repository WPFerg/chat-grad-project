var server = require("../server/server");
var request = require("request");
var assert = require("chai").assert;
var sinon = require("sinon");
var io = require("socket.io-client");

var testPort = 52684;
var baseUrl = "http://localhost:" + testPort;
var oauthClientId = "1234clientId";

var testUser = {
    _id: "bob",
    name: "Bob Bilson",
    avatarUrl: "http://avatar.url.com/u=test"
};
var testUser2 = {
    _id: "charlie",
    name: "Charlie Colinson",
    avatarUrl: "http://avatar.url.com/u=charlie_colinson"
};
var testGithubUser = {
    login: "bob",
    name: "Bob Bilson",
    avatar_url: "http://avatar.url.com/u=test"
};
var testToken = "123123";
var testExpiredToken = "987978";

describe("server", function() {
    var cookieJar;
    var db;
    var githubAuthoriser;
    var serverInstance;
    var dbCollections;
    beforeEach(function() {
        cookieJar = request.jar();
        dbCollections = {
            users: {
                find: sinon.stub(),
                findOne: sinon.stub(),
                insertOne: sinon.spy()
            },
            conversations: {
                find: sinon.stub(),
                insert: sinon.stub(),
                update: sinon.stub(),
                remove: sinon.spy()
            },
            groups: {
                findOne: sinon.stub(),
                find: sinon.stub(),
                save: sinon.stub()
            }
        };
        db = {
            collection: sinon.stub()
        };
        db.collection.withArgs("users").returns(dbCollections.users);
        db.collection.withArgs("conversations-wpferg2").returns(dbCollections.conversations);
        db.collection.withArgs("groups-wpferg").returns(dbCollections.groups);

        githubAuthoriser = {
            authorise: function() {},
            oAuthUri: "https://github.com/login/oauth/authorize?client_id=" + oauthClientId
        };
        serverInstance = server(testPort, db, githubAuthoriser);
    });
    afterEach(function() {
        serverInstance.close();
    });
    function authenticateUser(user, token, callback) {
        sinon.stub(githubAuthoriser, "authorise", function(req, authCallback) {
            authCallback(user, token);
        });

        dbCollections.users.findOne.callsArgWith(1, null, user);

        request(baseUrl + "/oauth", function(error, response) {
            cookieJar.setCookie(request.cookie("sessionToken=" + token), baseUrl);
            callback();
        });
    }
    describe("GET /oauth", function() {
        var requestUrl = baseUrl + "/oauth";

        it("responds with status code 400 if oAuth authorise fails", function(done) {
            var stub = sinon.stub(githubAuthoriser, "authorise", function(req, callback) {
                callback(null);
            });

            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 400);
                done();
            });
        });
        it("responds with status code 302 if oAuth authorise succeeds", function(done) {
            var user = testGithubUser;
            var stub = sinon.stub(githubAuthoriser, "authorise", function(req, authCallback) {
                authCallback(user, testToken);
            });

            dbCollections.users.findOne.callsArgWith(1, null, user);

            request({url: requestUrl, followRedirect: false}, function(error, response) {
                assert.equal(response.statusCode, 302);
                done();
            });
        });
        it("responds with a redirect to '/' if oAuth authorise succeeds", function(done) {
            var user = testGithubUser;
            var stub = sinon.stub(githubAuthoriser, "authorise", function(req, authCallback) {
                authCallback(user, testToken);
            });

            dbCollections.users.findOne.callsArgWith(1, null, user);

            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 200);
                assert.equal(response.request.uri.path, "/");
                done();
            });
        });
        it("add user to database if oAuth authorise succeeds and user id not found", function(done) {
            var user = testGithubUser;
            var stub = sinon.stub(githubAuthoriser, "authorise", function(req, authCallback) {
                authCallback(user, testToken);
            });

            dbCollections.users.findOne.callsArgWith(1, null, null);

            request(requestUrl, function(error, response) {
                assert(dbCollections.users.insertOne.calledOnce);
                assert.deepEqual(dbCollections.users.insertOne.firstCall.args[0], {
                    _id: "bob",
                    name: "Bob Bilson",
                    avatarUrl: "http://avatar.url.com/u=test"
                });
                done();
            });
        });
    });
    describe("GET /api/oauth/uri", function() {
        var requestUrl = baseUrl + "/api/oauth/uri";
        it("responds with status code 200", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 200);
                done();
            });
        });
        it("responds with a body encoded as JSON in UTF-8", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
                done();
            });
        });
        it("responds with a body that is a JSON object containing a URI to GitHub with a client id", function(done) {
            request(requestUrl, function(error, response, body) {
                assert.deepEqual(JSON.parse(body), {
                    uri: "https://github.com/login/oauth/authorize?client_id=" + oauthClientId
                });
                done();
            });
        });
    });
    describe("GET /api/user", function() {
        var requestUrl = baseUrl + "/api/user";
        it("responds with status code 401 if user not authenticated", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });
        it("responds with status code 401 if user has an unrecognised session token", function(done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request({url: requestUrl, jar: cookieJar}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });
        it("responds with status code 200 if user is authenticated", function(done) {
            authenticateUser(testUser, testToken, function() {
                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });
        it("responds with a body that is a JSON representation of the user if user is authenticated", function(done) {
            authenticateUser(testUser, testToken, function() {
                request({url: requestUrl, jar: cookieJar}, function(error, response, body) {
                    assert.deepEqual(JSON.parse(body), {
                        _id: "bob",
                        name: "Bob Bilson",
                        avatarUrl: "http://avatar.url.com/u=test"
                    });
                    done();
                });
            });
        });
        it("responds with status code 500 if database error", function(done) {
            authenticateUser(testUser, testToken, function() {

                dbCollections.users.findOne.callsArgWith(1, {err: "Database error"}, null);

                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });
    });
    describe("GET /api/users", function() {
        var requestUrl = baseUrl + "/api/users";
        var allUsers;
        beforeEach(function() {
            allUsers = {
                toArray: sinon.stub()
            };
            dbCollections.users.find.returns(allUsers);
        });
        it("responds with status code 401 if user not authenticated", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });
        it("responds with status code 401 if user has an unrecognised session token", function(done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request({url: requestUrl, jar: cookieJar}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });
        it("responds with status code 200 if user is authenticated", function(done) {
            authenticateUser(testUser, testToken, function() {
                allUsers.toArray.callsArgWith(0, null, [testUser]);

                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });
        it("responds with a body that is a JSON representation of the user if user is authenticated", function(done) {
            authenticateUser(testUser, testToken, function() {
                allUsers.toArray.callsArgWith(0, null, [
                        testUser,
                        testUser2
                    ]);

                request({url: requestUrl, jar: cookieJar}, function(error, response, body) {
                    assert.deepEqual(JSON.parse(body), [
                        {
                            id: "bob",
                            name: "Bob Bilson",
                            avatarUrl: "http://avatar.url.com/u=test"
                        },
                        {
                            id: "charlie",
                            name: "Charlie Colinson",
                            avatarUrl: "http://avatar.url.com/u=charlie_colinson"
                        }
                    ]);
                    done();
                });
            });
        });
        it("responds with status code 500 if database error", function(done) {
            authenticateUser(testUser, testToken, function() {
                allUsers.toArray.callsArgWith(0, {err: "Database failure"}, null);

                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });
    });
    describe("GET /api/conversations", function() {
        var requestUrl = baseUrl + "/api/conversations";
        var allConversations;
        beforeEach(function() {
            allConversations = {
                toArray: sinon.stub(),
            };
            dbCollections.conversations.find.returns(allConversations);
        });

        it("responds with status code 401 if user not authenticated", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function(done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request({url: requestUrl, jar: cookieJar}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with status code 200 if user is authenticated", function(done) {
            authenticateUser(testUser, testToken, function() {

                allConversations.toArray.callsArgWith(0, null, [
                    {
                        between: ["bob", "charlie"],
                        body: "Hah",
                        sent: 1234,
                        seen: false
                    },
                    {
                        between: ["bob", "charlie"],
                        body: "Hah",
                        sent: 1234,
                        seen: false,
                        groupId: 12
                    }
                ]);
                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("returns the most recent message sent", function(done) {
            authenticateUser(testGithubUser, testToken, function() {

                allConversations.toArray.callsArgWith(0, null, [
                    {
                        between: ["bob", "charlie"],
                        body: "Hah",
                        sent: 1234,
                        seen: [false]
                    },
                    {
                        between: ["bob", "charlie"],
                        body: "Haha",
                        sent: 1235,
                        seen: [false]
                    },
                    {
                        between: ["bob", "charlie"],
                        body: "Haha",
                        sent: 1231,
                        seen: [true]
                    },
                    {
                        between: ["charlie", "bob"],
                        body: "Haha",
                        sent: 1237,
                        seen: [false]
                    }
                ]);
                request({url: requestUrl, jar: cookieJar}, function(error, response, body) {
                    assert.equal(response.statusCode, 200);
                    var json = JSON.parse(body);
                    assert.equal(json[0].lastMessage, 1237);
                    assert.equal(json[0].anyUnseen, true);
                    done();
                });
            });
        });

        it("correctly sets seen", function(done) {
            authenticateUser(testGithubUser, testToken, function() {

                allConversations.toArray.callsArgWith(0, null, [
                    {
                        between: ["charlie", "bob"],
                        body: "Hah",
                        sent: 1233,
                        seen: [true]
                    },
                    {
                        between: ["bob", "charlie"],
                        body: "Haha",
                        sent: 1234,
                        seen: [true]
                    },
                    {
                        between: ["charlie", "bob"],
                        body: "Haha",
                        sent: 1235,
                        seen: [true]
                    }
                ]);
                request({url: requestUrl, jar: cookieJar}, function(error, response, body) {
                    assert.equal(response.statusCode, 200);
                    var json = JSON.parse(body);
                    assert.equal(json[0].lastMessage, 1235);
                    assert.equal(json[0].anyUnseen, false);
                    done();
                });
            });
        });

        it("responds with status code 500 if there is a db error", function(done) {
            authenticateUser(testGithubUser, testToken, function() {

                allConversations.toArray.callsArgWith(0, {error: "somethign"}, null);
                request({url: requestUrl, jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });
    });
    describe("GET /api/conversation/:userId", function() {
        var requestUrl = baseUrl + "/api/conversations";
        var allConversations;
        var allGroups;
        beforeEach(function() {
            allConversations = {
                toArray: sinon.stub()
            };
            allGroups = dbCollections.groups;
            dbCollections.conversations.find.returns(allConversations);
        });

        it("responds with status code 401 if user not authenticated", function(done) {
            request(requestUrl, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function(done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request({url: requestUrl, jar: cookieJar}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with status code 200 if user is authenticated", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {});

                allConversations.toArray.callsArgWith(0, null, [
                    {
                        between: ["bob", "charlie"],
                        sent: 2384907238947,
                        body: "hello",
                        seen: [false]
                    },
                    {
                        between: ["charlie", "bob"],
                        sent: 2384907238949,
                        body: "hello",
                        seen: [false]
                    },
                    {
                        between: ["charlie", "bob"],
                        sent: 2384907238949,
                        body: "hello",
                        seen: [true]
                    }
                ]);
                request({url: requestUrl + "/charlie", jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with status code 200 if user is authenticated, querying group info", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {
                    users: ["bob", "charlie"]
                });

                allConversations.toArray.callsArgWith(0, null, [
                    {
                        between: ["bob", "charlie"],
                        sent: 2384907238947,
                        body: "hello",
                        seen: [false]
                    },
                    {
                        between: ["charlie", "bob"],
                        sent: 2384907238949,
                        body: "hello",
                        seen: [false]
                    },
                    {
                        between: ["charlie", "bob"],
                        sent: 2384907238949,
                        body: "hello",
                        seen: [true]
                    }
                ]);
                request({url: requestUrl + "/charlie", jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with status code 500 if there is a db error", function(done) {
            authenticateUser(testGithubUser, testToken, function() {

                allGroups.findOne.callsArgWith(1, null, {
                    users: ["bob", "charlie"]
                });
                allConversations.toArray.callsArgWith(0, {error: "somethign"}, null);
                request({url: requestUrl + "/charlie", jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });

        it("responds with status code 401 if there is no user to get conversations to", function(done) {
            authenticateUser(testGithubUser, testToken, function() {

                allConversations.toArray.callsArgWith(0, {error: "somethign"}, null);
                request({url: requestUrl + "/", jar: cookieJar}, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });
    });
    describe("POST /api/conversation/:userId", function() {
        var requestUrl = baseUrl + "/api/conversations";
        var allConversations;
        var allGroups;
        beforeEach(function() {
            allConversations = {
                toArray: sinon.stub()
            };
            allGroups = dbCollections.groups;
            dbCollections.conversations.find.returns(allConversations);
        });

        it("responds with status code 401 if user not authenticated", function(done) {
            request.post({url: requestUrl + "/uid", json: {}}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function(done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request.post({url: requestUrl + "/uid", jar: cookieJar, json: {}}, function(error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with status code 200 if user is authenticated", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {});
                dbCollections.conversations.insert.callsArgWith(2, null, "this is not an error");
                request.post({url: requestUrl + "/charlie",
                    jar: cookieJar,
                    json: {
                        body: "Hello!",
                        sent: 1234
                    }
                }, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with status code 200 if user is authenticated, and requests group info", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {
                    users: ["bob", "charlie"]
                });
                dbCollections.conversations.insert.callsArgWith(2, null, "this is not an error");
                request.post({url: requestUrl + "/charlie",
                    jar: cookieJar,
                    json: {
                        body: "Hello!",
                        sent: 1234
                    }
                }, function(error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with status code 500 if there is a db error adding the messaeg", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {
                    users: ["bob", "charlie"]
                });
                dbCollections.conversations.insert.callsArgWith(2, "this is an error", null);
                request.post({url: requestUrl + "/charlie",
                    jar: cookieJar,
                    json: {
                        body: "Hello!",
                        sent: 1234
                    }
                }, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });

        it("responds with status code 500 if there is a db error querying groups", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, {}, null);
                dbCollections.conversations.insert.callsArgWith(2, "this is an error", null);
                request.post({url: requestUrl + "/charlie",
                    jar: cookieJar,
                    json: {
                        body: "Hello!",
                        sent: 1234
                    }
                }, function(error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });

        it("responds with status code 401 if the post body is invalid", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.findOne.callsArgWith(1, null, {
                    users: ["bob", "charlie"]
                });
                dbCollections.conversations.insert.callsArgWith(2, null, "this is not an error");
                request.post({url: requestUrl + "/charlie",
                    jar: cookieJar,
                    json: {
                        I: "am invalid"
                    }
                }, function(error, response) {
                    assert.equal(response.statusCode, 401);
                    done();
                });
            });
        });
    });

    describe("DELETE /api/conversations/:userId", function() {
        var requestUrl = baseUrl + "/api/conversations/charlie";
        var allConversations;
        beforeEach(function () {
            allConversations = {
                toArray: sinon.stub()
            };
            dbCollections.conversations.find.returns(allConversations);
        });

        it("responds with status code 401 if user not authenticated", function (done) {
            request.del(requestUrl, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function (done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request.del({url: requestUrl, jar: cookieJar}, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 200 if the user is authenticated and a group is provided", function (done) {
            authenticateUser(testGithubUser, testToken, function() {

                dbCollections.groups.findOne.callsArgWith(1, null, {users: ["a", "b"]});

                request.del({url: requestUrl, jar: cookieJar}, function (error, response) {
                    assert.equal(response.statusCode, 200);
                    assert.equal(dbCollections.conversations.remove.called, true);
                    done();
                });
            });
        });

        it("responds with 200 if the user is authenticated", function (done) {
            authenticateUser(testGithubUser, testToken, function() {

                dbCollections.groups.findOne.callsArgWith(1, null, {notUsers: [true]});

                request.del({url: requestUrl, jar: cookieJar}, function (error, response) {
                    assert.equal(response.statusCode, 200);
                    assert.equal(dbCollections.conversations.remove.called, true);
                    done();
                });
            });
        });
        it("does not delete if there is an error looking for matching groups", function (done) {
            authenticateUser(testGithubUser, testToken, function() {

                dbCollections.groups.findOne.callsArgWith(1, {}, null);

                request.del({url: requestUrl, jar: cookieJar}, function (error, response) {
                    assert.equal(dbCollections.conversations.remove.called, false);
                    done();
                });
            });
        });
    });

    describe("GET /api/groups", function() {
        var requestUrl = baseUrl + "/api/groups";
        var allGroups;

        beforeEach(function() {
            allGroups = {
                toArray: sinon.stub()
            };

            dbCollections.groups.find.returns(allGroups);
        });

        it("responds with status code 401 if user not authenticated", function (done) {
            request(requestUrl, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function (done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request({url: requestUrl, jar: cookieJar}, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 200 and outputs correct data if user is authenticated", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.toArray.callsArgWith(0, null, [{
                    _id: "bob's dodgy gruop",
                    title: "Not Dodgy At All",
                    users: ["bob", "bob's 'friend'"]
                }]);

                request({url: requestUrl, jar: cookieJar}, function (error, response, body) {
                    assert.deepEqual(JSON.parse(body), [{
                        id: "bob's dodgy gruop",
                        title: "Not Dodgy At All",
                        users: ["bob", "bob's 'friend'"]
                    }]);
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with 500 if there is a db error", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                allGroups.toArray.callsArgWith(0, {"Should've coded": "Better"}, null);

                request({url: requestUrl, jar: cookieJar}, function (error, response) {
                    assert.equal(response.statusCode, 500);
                    done();
                });
            });
        });
    });

    describe("PUT /api/groups", function() {
        var requestUrl = baseUrl + "/api/groups/bobsDodgyGroup";

        it("responds with status code 401 if user not authenticated", function (done) {
            request.put(requestUrl, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 401 if the token is expired", function (done) {
            cookieJar.setCookie(request.cookie("sessionToken=" + testExpiredToken), baseUrl);
            request.put({url: requestUrl, jar: cookieJar}, function (error, response) {
                assert.equal(response.statusCode, 401);
                done();
            });
        });

        it("responds with 200 if user is authenticated and object exists", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                dbCollections.groups.save.callsArgWith(1, null, {
                    result: {
                        nModified: 0
                    }
                });

                request.put({url: requestUrl, jar: cookieJar, json: {
                    title: "Dodgetacular",
                    users: ["Nobody", "Shady", "At", "All"]
                }}, function (error, response) {
                    assert.equal(response.statusCode, 201);
                    done();
                });
            });
        });

        it("responds with 200 if user is authenticated and object doesn't exist", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                dbCollections.groups.save.callsArgWith(1, null, {
                    result: {
                        nModified: 1
                    }
                });

                request.put({url: requestUrl, jar: cookieJar, json: {
                    title: "Dodgetacular",
                    users: ["Nobody", "Shady", "At", "All"]
                }}, function (error, response) {
                    assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it("responds with 400 if there is a bad request", function(done) {
            authenticateUser(testGithubUser, testToken, function() {
                dbCollections.groups.save.callsArgWith(0, {"Should've coded": "Better"}, null);

                request.put({url: requestUrl, jar: cookieJar}, function (error, response) {
                    assert.equal(response.statusCode, 400);
                    done();
                });
            });
        });
    });

    describe("WebSocket Connections", function() {
        var socket1;
        var socket2;
        var allConversations;
        var allGroups;
        beforeEach(function (done) {
            var numReady = 0;
            socket1 = io.connect("http://localhost:" + testPort + "/realtime", {
                "force new connection": true
            });
            socket2 = io.connect("http://localhost:" + testPort + "/realtime", {
                "force new connection": true
            });

            socket1.on("connect", function() {
                socket1.emit("userId", "bob");
                socketReady();
            });
            socket2.on("connect", function() {
                socket2.emit("userId", "charlie");
                socketReady();
            });

            function socketReady() {
                numReady++;
                if (numReady === 2) {
                    done();
                }
            }

            allConversations = {
                toArray: sinon.stub()
            };
            allGroups = dbCollections.groups;
            dbCollections.conversations.find.returns(allConversations);
        });

        afterEach(function() {
            socket1.close();
            socket2.close();
        });

        it("should connect", function(done) {
            assert.equal(socket1.connected, true);
            assert.equal(socket2.connected, true);
            done();
        });

        it("should allow messages to be sent and broadcast to recipients", function (done) {
            allGroups.findOne.callsArgWith(1, null, null);
            dbCollections.conversations.insert.callsArgWith(2, null);

            socket1.emit("message", {
                to: "charlie",
                body: "yes",
                sent: 1234567
            });

            socket2.on("message", function() {
                done();
            });
        });

        it("should allow messages to be sent, but on insertion error wouldn't be rebroadcast", function (done) {
            allGroups.findOne.callsArgWith(1, null, null);
            dbCollections.conversations.insert.callsArgWith(2, {"Insertion error": "Whoops"});

            socket1.emit("message", {
                to: "charlie",
                body: "yes",
                sent: 1234567
            });

            socket2.on("message", function() {
                done(new Error("It was rebroadcast."));
            });

            setTimeout(done, 1900);
        });

        it("should allow messages to be sent, but on lookup error wouldn't be rebroadcast", function (done) {
            allGroups.findOne.callsArgWith(1, {"Whoops": 404}, null);
            dbCollections.conversations.insert.callsArgWith(2,  null, null);

            socket1.emit("message", {
                to: "charlie",
                body: "yes",
                sent: 1234567
            });

            socket2.on("message", function() {
                done(new Error("It was rebroadcast."));
            });

            setTimeout(done, 1900);
        });

        it("should allow messages to be sent to groups", function (done) {
            allGroups.findOne.callsArgWith(1, null, {
                groupId: "something",
                users: ["bob", "charlie"]
            });
            dbCollections.conversations.insert.callsArgWith(2, null, {});

            socket1.emit("message", {
                to: "charlie",
                body: "yes",
                sent: 1234567
            });

            socket2.on("message", function() {
                done();
            });
        });

        it("should allow messages to be sent, but not rebroadcast if the message sent is invalid", function (done) {
            allGroups.findOne.callsArgWith(1, null, {
                groupId: "something",
                users: ["bob", "charlie"]
            });
            dbCollections.conversations.insert.callsArgWith(2, null, {});

            socket1.emit("message", {});

            socket2.on("message", function() {
                done(new Error("It was rebroadcast."));
            });

            setTimeout(done, 1900);
        });
    });
});
