(function() {
    var app = angular.module("ChatApp", ["ngMaterial"]);

    app.config(function($mdThemingProvider) {
        $mdThemingProvider.theme("default")
            .primaryPalette("pink")
            .accentPalette("blue");
    });

    app.directive("receivedChatItem", function() {
        return {
            restrict: "E",
            templateUrl: "receivedChatItem.template.html"
        };
    });

    app.directive("sentChatItem", function() {
        return {
            restrict: "E",
            templateUrl: "sentChatItem.template.html"
        };
    });

    app.directive("addGroup", function() {
        return {
            restrict: "E",
            templateUrl: "addGroup.template.html"
        };
    });

    app.directive("mdTabContent", function() {
        return {
            restrict: "E",
            link: function(scope, element, attrs) {
                scope.isAtBottom = true;
                element = element[0];

                element.onscroll = function () {
                    var browserHeight = window.innerHeight;
                    var bodyHeight = element.scrollHeight;
                    var scrolled = element.scrollTop;

                    scope.isAtBottom = (Math.abs(scrolled / (bodyHeight - browserHeight))) > 0.95;
                };

                element.addEventListener("DOMNodeInserted", function() {
                    if (scope.isAtBottom) {
                        element.scrollTop = element.scrollHeight;
                    }
                });
            }
        };
    });

    app.controller("ChatController", function($scope, $http, $interval, $timeout, $mdToast, $mdDialog) {
        $scope.loggedIn = false;
        $scope.activeChats = [];
        $scope.selectedTab = 0;
        $scope.visibleChatFilter = {hidden: "!true"};
        $scope.addGroupSelectedUsers = [];
        $scope.socket = null;

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

                $scope.$pollServer();
            });

            $http.get("/api/groups").then(function (result) {
                $scope.groups = result.data;
            });

            $scope.setUpSockets();
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
                            cachedChat.anyUnseen = true;
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

            if ($scope.socket) {
                $scope.$sendSocketMessage(to, message);
            } else {
                $http.post("/api/conversations/" + to, message);
            }

            message.from = $scope.user;
            chat.currentlyTypedMessage = "";
            //chat.messages.push(message);
            chat.lastMessage = message.sent;
        };

        $scope.addChat = function(user) {

            var matchingChats = $scope.activeChats.filter(function (otherChat) {
                return otherChat.user.id === user.id;
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

        $scope.showAddGroupDialog = function() {
            $scope.showAddGroup = true;
        };

        $scope.addGroupCancel = function() {
            $scope.showAddGroup = false;
            $scope.addGroupIdDisabled = false;
            $scope.addGroupSelectedUsers = [];
            $scope.addGroupId = "";
            $scope.addGroupName = "";
        };

        $scope.viewOrEditGroup = function(group) {
            if ($scope.groupEditMode) {
                $scope.editGroup(group);
            } else {
                $scope.addChat(group);
            }
        };

        $scope.editGroup = function(group) {
            console.log(group);
            $scope.showAddGroup = true;
            $scope.addGroupIdDisabled = true;
            $scope.addGroupId = group.id;
            $scope.addGroupName = group.title;
            $scope.addGroupSelectedUsers = group.users.map(function(user) { return $scope.$getUserById(user); });
        };

        $scope.toggleEditMode = function() {
            $scope.groupEditMode = !$scope.groupEditMode;
        };

        $scope.addGroupCreate = function() {
            $scope.addGroupSelectedUsers.push($scope.user);
            var groupObj = {
                title: $scope.addGroupName,
                users: $scope.addGroupSelectedUsers.map(function (user) {
                    return user.id;
                })
            };
            var gId = $scope.addGroupId;
            if (gId) {
                $http.put("/api/groups/" + gId, groupObj).then(function (success) {
                    $scope.showAddGroup = false;
                    $scope.groupEditMode = false;
                    $scope.addGroupSelectedUsers = [];
                    $scope.addGroupName = "";

                    $scope.addChat({
                        id: gId
                    });
                    $scope.groups.push({
                        id: gId,
                        title: groupObj.title
                    });
                });
            }
        };

        $scope.$changeTabToChat = function (chatToSearchFor) {
            var numberOfChats = $scope.activeChats.length;
            for (var i = 0; i < numberOfChats; i++) {
                var chat = $scope.activeChats[i];
                if (angular.equals(chat.user, chatToSearchFor.user)) {
                    chat.hidden = false;
                    $scope.selectedTab = i + 1; // +1 because of the first chat tab
                    break;
                }
            }
        };

        $scope.hideTab = function (index) {
            $scope.activeChats[index].hidden = true;

            if (index < $scope.selectedTab) {
                $scope.selectedTab--;
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
            var userGroupHybrid = $scope.allUsers.concat($scope.groups);
            return userGroupHybrid.filter(function (user) {
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
                            $scope.$addMessageToChat(message, chat, true);
                        });
                    }
                    chat.isLoading = false;
                    chat.anyUnseen = false;
                });
            }
        };

        $scope.$addMessageToChat = function(message, chat, hideAllNotifications) {
            message.from = $scope.$getUserById(message.from);
            if (!chat) {
                var possibleGroup = $scope.$getUserById(message.groupId);
                var otherUser = message.between.filter(function (otherUser) {
                    return otherUser !== $scope.user.id;
                })[0];
                var possibleUser = $scope.$getUserById(otherUser);
                chat = $scope.$getChatByUser(possibleGroup || possibleUser);

                // Still no chat? create
                if (!chat) {
                    chat = $scope.addChat(possibleGroup || possibleUser);
                }
            }

            if (typeof message.seen === "boolean") {
                message.seen = [message.seen];
            }

            if (message.from.id !== $scope.user.id) {
                message.userIndex = message.between.indexOf($scope.user.id);
            }

            var messagesAtSameTime = chat.messages.filter(function (otherMessage) {
                return otherMessage.sent === message.sent;
            });

            if (messagesAtSameTime.length === 0) {
                chat.messages.push(message);
                if (message.from.id !== $scope.user.id && !hideAllNotifications) {
                    $scope.notify(message);
                    message.seen = [true];
                }
            } else {
                // Update seen ticks
                messagesAtSameTime.forEach(function (otherMessage) {
                    otherMessage.seen = message.seen;
                });
            }

            $scope.$reorderTabs();
        };

        $scope.$pollServer = function() {
            $scope.$pollActiveChat();
            $scope.getConversations();

            // Have a slower poll interval if there's a socket open;
            // allows compatibility for other messaging servers using
            // the same api.
            var timeout = $scope.socket ? 10000 : 1000;
            $timeout($scope.$pollServer, timeout);
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

            var chat;

            if ($scope.selectedTab !== 0) {
                chat = $scope.activeChats[$scope.selectedTab];
            }

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

            if (chat) {
                $scope.selectedTab = $scope.$getIndexOfChat(chat);
            }
        };

        $scope.$getIndexOfChat = function(chat) {
            var noOfChats = $scope.activeChats.length;

            for (var i = 0; i < noOfChats; i++) {
                var otherChat = $scope.activeChats[i];

                if (otherChat.user.id === chat.user.id) {
                    return i;
                }
            }
        };

        $scope.findUserMatches = function(users, searchText) {
            return users.filter(function (user) {
                return user.id.indexOf(searchText) !== -1 || (user.name && user.name.indexOf(searchText) !== -1);
            });
        };

        $scope.autocompleteSelectedItemChange = function (selectedUser, arrayToPush, clearCallback) {
            if (typeof arrayToPush === "undefined") {
                arrayToPush = [];
            }

            if (selectedUser) {
                arrayToPush.push(selectedUser);
                if (clearCallback) {
                    clearCallback();
                }
            }
        };

        $scope.clearAddGroupEnteredText = function() {
            $scope.addGroupEnteredText = "";
        };

        $scope.setUpSockets = function() {
            $scope.socket = io(window.location.protocol + "//" + window.location.host + "/realtime");
            $scope.socket.on("connect", function () {
                $scope.socket.emit("userId", $scope.user.id);
            });
            $scope.socket.on("message", function (message) {
                $scope.$addMessageToChat(message);
            });
        };

        $scope.$sendSocketMessage = function(to, message) {
            if ($scope.socket) {
                message.to = to;
                $scope.socket.emit("message", message);
            }
        };
    });
}
)();
