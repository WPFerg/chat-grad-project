(function() {
    var app = angular.module("ChatApp", ["ngMaterial"]);

    app.config(function($mdThemingProvider) {
        $mdThemingProvider.theme("default")
            .primaryPalette("pink")
            .accentPalette("blue");
    });

    app.controller("ChatController", function($scope, $http, $interval, $timeout, $mdToast) {
        $scope.loggedIn = false;
        $scope.activeChats = [];
        $scope.selectedTab = 0;
        $scope.visibleChatFilter = {hidden: '!true'};

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
                        var newChat = {
                            user: $scope.$getUserById(conversation.user),
                            messages: [],
                            lastMessage: conversation.lastMessage,
                            anyUnseen: conversation.anyUnseen || false
                        };
                        if (newChat.anyUnseen) {
                            $scope.notifyUnreadChat(newChat);
                        }
                        $scope.activeChats.push(newChat);
                    } else {
                        var cachedChat = matchingChats[0];

                        if (cachedChat.lastMessage < conversation.lastMessage) {
                            cachedChat.lastMessage = conversation.lastMessage;
                            cachedChat.anyUnseen = conversation.anyUnseen;
                            cachedChat.hidden = false;
                            if (!$scope.$isActiveChat(cachedChat)) {
                                $scope.notifyUnreadChat(cachedChat);
                            }
                        }
                    }
                });
                $scope.$reorderTabs();
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
            chat.lastMessage = message.sent;
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

        $scope.hideTab = function (index) {
            $scope.activeChats[index].hidden = true;
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
                    chat.anyUnseen = false;
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
                                if (message.from.id !== $scope.user.id) {
                                    $scope.notify(message);
                                }
                            }
                        });
                    }
                    chat.isLoading = false;
                    chat.anyUnseen = false;
                });
            }
        };

        $scope.$pollServer = function() {
            $scope.$pollActiveChat();
            $scope.getConversations();
        };

        $scope.setUpNotifications = function() {
            if ($scope.desktopNotifications === "default" || !$scope.desktopNotifications) {
                $scope.$requestNotificationPermission();
            }
        };

        $scope.$requestNotificationPermission = function() {
            if ("Notification" in window) {
                Notification.requestPermission(function (result) {
                    if (result !== "default") {
                        $scope.desktopNotifications = result;
                    }
                });
            } else {
                $scope.desktopNotifications = "denied";
            }
        };

        $scope.notify = function(message) {
            if ($scope.desktopNotifications === "granted") {
                $scope.$desktopNotification(message);
            } else {
                $scope.$showToast(message);
            }
        };

        $scope.$desktopNotification = function(message) {
            var notif = new Notification(message.from.name || message.from.id, {
                icon: message.from.avatarUrl,
                body: message.body
            });

            $timeout(function() { notif.close(); }, 3000);
        };

        $scope.$showToast = function(message) {
            var toast = $mdToast.simple()
                .content((message.from.name || message.from.id) + ": " + message.body)
                .highlightAction(false)
                .position("bottom right");

            $mdToast.show(toast);
        };

        $scope.$isActiveChat = function(chat) {
            if ($scope.selectedTab !== 0) {
                var activeChat = $scope.activeChats[$scope.selectedTab - 1];
                return activeChat.user.id === chat.user.id;
            }
            return false;
        };

        $scope.notifyUnreadChat = function(chat) {
            $scope.notify({from: chat.user,
                body: "has sent you a message"
            });
        };

        // Check for notification permission
        if (Notification && Notification.permission !== "default") {
            $scope.desktopNotifications = Notification.permission;
        }

        $scope.$reorderTabs = function () {
            $scope.activeChats.sort(function(left, right) {
                if (!left.lastMessage) {
                    return 0;
                }
                if (!right.lastMessage) {
                    return 0;
                }
                var leftTime = left.lastMessage;
                var rightTime = right.lastMessage;

                return (leftTime > rightTime) ? -1 : (leftTime === rightTime) ? 0 : 1;
            });
        };
    });
})();
