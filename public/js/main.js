(function() {
    var app = angular.module("ChatApp", ["ngMaterial"]);

    app.config(function($mdThemingProvider) {
        $mdThemingProvider.theme("default")
            .primaryPalette("pink")
            .accentPalette("blue");
    });

    app.controller("ChatController", function($scope, $http, $interval) {
        $scope.loggedIn = false;
        $scope.activeChats = [];
        $scope.selectedTab = 0;

        // Setup
        $http.get("/api/user").then(function (userResult) {
            $scope.loggedIn = true;
            $scope.user = userResult.data;
            $scope.user.id = $scope.user._id;

            $http.get("/api/users").then(function (result) {
                $scope.users = result.data.filter(function (user) {
                    return $scope.user.id !== user.id;
                });
                $scope.allUsers = result.data;

                $interval($scope.$pollServer, 1000);
                $scope.getConversations();
            });
        }, function () {
            $http.get("/api/oauth/uri").then(function (result) {
                $scope.loginUri = result.data.uri;
            });
        });

        $scope.getConversations = function () {
            $http.get("/api/conversations").then(function (data) {
                data.data.forEach(function (conversation) {
                    var user = $scope.$getUserById(conversation.user);

                    var matchingChats = $scope.activeChats.filter(function (chat) {
                        return chat.user === user;
                    });

                    if (matchingChats.length === 0) {
                        $scope.activeChats.push({
                            user: $scope.$getUserById(conversation.user),
                            messages: [],
                            lastMessage: conversation.lastMessage,
                            anyUnseen: conversation.anyUnseen || false
                        });
                    } else {
                        var cachedChat = matchingChats[0];

                        if (cachedChat.lastMessage < conversation.lastMessage) {
                            cachedChat.lastMessage = conversation.lastMessage;
                            cachedChat.anyUnseen = conversation.anyUnseen;
                        }
                    }
                });
            });
        };

        $scope.getConversation = function (userId, callback) {
            $http.get("/api/conversations/" + userId).then(function (data) {
                callback(data.data);
            });
        };

        $scope.sendMessage = function(chat) {
            var to = chat.user.id;
            var message = {
                body: chat.currentlyTypedMessage,
                sent: new Date().valueOf()
            };

            $http.post("/api/conversations/" + to, message);

            message.from = $scope.user;
            chat.currentlyTypedMessage = "";
            chat.messages.push(message);
        };

        $scope.addChat = function(user) {

            var matchingChats = $scope.activeChats.filter(function (otherChat) {
                return otherChat.user === user;
            });
            var chatToSearchFor;

            if (matchingChats.length === 0) {
                var chatObject = {
                    user: user,
                    messages: []
                };
                $scope.activeChats.push(chatObject);
                chatToSearchFor = chatObject;
            } else {
                chatToSearchFor = matchingChats[0];
            }

            $scope.$changeTabToChat(chatToSearchFor);
        };

        $scope.$changeTabToChat = function (chatToSearchFor) {
            var numberOfChats = $scope.activeChats.length;
            for (var i = 0; i < numberOfChats; i++) {
                var chat = $scope.activeChats[i];
                if (angular.equals(chat.user, chatToSearchFor.user)) {
                    $scope.selectedTab = i + 1; // +1 because of the first chat tab
                    break;
                }
            }
        };

        $scope.chatHasUnreadMessages = function (user) {
            var chat = $scope.$getChatByUser(user);

            if (chat) {
                return chat.anyUnseen;
            }
        };

        $scope.$getChatByUser = function (user) {

            var matchingChats = $scope.activeChats.filter(function (chat) {
                return chat.user.id === user.id;
            });

            if (matchingChats.length !== 0) {
                return matchingChats[0];
            }
        };

        $scope.$getUserById = function (userId) {
            return $scope.allUsers.filter(function (user) {
                return user.id === userId;
            })[0];
        };

        $scope.$watch("selectedTab", function(current, old) {
            if (current !== 0) {
                var chat = $scope.activeChats[current - 1];
                if (chat.messages.length === 0) {
                    chat.isLoading = true;
                    $scope.$pollActiveChat();
                }
            }
        });

        $scope.$pollActiveChat = function() {
            if ($scope.selectedTab !== 0) {
                var chat = $scope.activeChats[$scope.selectedTab - 1];
                $scope.getConversation(chat.user.id, function(data) {
                    if (data) {
                        data.forEach(function(message) {
                            message.from = $scope.$getUserById(message.from);

                            var messagesAtSameTime = chat.messages.filter(function (otherMessage) {
                                return otherMessage.sent === message.sent;
                            });

                            if (messagesAtSameTime.length === 0) {
                                chat.messages.push(message);
                            }
                        });
                    }
                    chat.isLoading = false;
                });
            }
        };

        $scope.$pollServer = function() {
            $scope.$pollActiveChat();
            $scope.getConversations();
        };
    });
})();
