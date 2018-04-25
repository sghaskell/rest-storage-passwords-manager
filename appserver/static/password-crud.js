'use strict';

require(['jquery',
        'underscore',
        'splunkjs/mvc',
        'splunkjs/mvc/utils',
        'splunkjs/mvc/tokenutils',
        'splunkjs/mvc/messages',
        'splunkjs/mvc/searchmanager',
        "splunkjs/mvc/multidropdownview",        
        '/static/app/password-manager/Modal.js',
        'splunkjs/mvc/simpleform/input/dropdown',
        'splunkjs/mvc/simplexml/ready!'],
function ($,
          _,
          mvc,
          utils,
          TokenUtils,
          Messages,
          SearchManager,
          MultiDropdownView,
          Modal,
          Dropdown) {

    function showPassword(row) {
        renderModal("show-password",
                    "Clear Password",
                    "<p>" + row.clear_password + "</p>",
                    "Close");
    }

    function anonCallback(callback=function(){}, callbackArgs=null) {
        if(callbackArgs) {
            callback.apply(this, callbackArgs);
        } else { 
            callback();
        }
    }

    function execSearch(searchString, id) {
        
        console.log("Executing search: " + searchString);
        var dfd = $.Deferred();
        var searchId = "generic-search-" + id;
        var componentExists = mvc.Components.getInstance(searchId);
        
        if(!componentExists) {
            var genericSearch = new SearchManager({
                id: searchId,
                search: searchString,
                cache: false
            });
        }

        var mainSearch = splunkjs.mvc.Components.getInstance(searchId);
        var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

        mainSearch.on('search:done', function(properties) {

            if(properties.content.resultCount == 0) {
                console.log("No Results");
                dfd.reject("No Results");
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            dfd.resolve(data);
        });

        return dfd.promise();

    }

    function renderCreateModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {
        var myModal = new Modal(id, {
                    title: title,
                    destroyOnHide: true,
                    type: 'wide'
        }); 
    
        myModal.body.append($(body));
    
        return myModal;
    }

    function renderModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {

        var myModal = new Modal(id, {
                    title: title,
                    destroyOnHide: true,
                    type: 'wide'
        }); 
    
        myModal.body.append($(body));
    
        myModal.footer.append($('<button>').attr({
            type: 'button',
            'data-dismiss': 'modal'
        }).addClass('btn btn-primary mlts-modal-submit').text(buttonText).on('click', function () {
                anonCallback(callback, callbackArgs); 
            }))

        myModal.show(); // Launch it!  
    }

    /* Run Search */
    function runSearch() {
        var contextMenuDiv = '#context-menu';
        var passwordTableDiv = '#password-table';

        // | rest /servicesNS/-/-/authentication/users | table title | rename title as user
        // | rest /servicesNS/-/-/apps/local | table title, label | rename title as app_name, label as app_description
        
        var search1 = new SearchManager({
                "id": "search1",
                "cancelOnUnload": true,
                "status_buckets": 0,
                "earliest_time": "-24h@h",
                "latest_time": "now",
                "sample_ratio": 1,
                "search": "| rest /servicesNS/-/-/storage/passwords \
                           | table username, password, realm, clear_password, eai:acl.app, eai:acl.owner, eai:acl.perms.read, eai:acl.perms.write, eai:acl.sharing \
                           | rename eai:acl.app as app, eai:acl.owner as owner, eai:acl.perms.read as acl_read, eai:acl.perms.write as acl_write, eai:acl.sharing as acl_sharing",
                "app": utils.getCurrentApp(),
                "auto_cancel": 90,
                "preview": true,
                "tokenDependencies": {
                },
                "runWhenTimeIsUndefined": false
            }, {tokens: true, tokenNamespace: "submitted"});

        var mainSearch = splunkjs.mvc.Components.getInstance("search1");
        var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

        mainSearch.on('search:progress', function(properties) {
            Messages.render("waiting", $(passwordTableDiv));
        });

        mainSearch.on('search:done', function(properties) {
            document.getElementById("password-table").innerHTML = "";

            if(properties.content.resultCount == 0) {
                console.log("No Results");
                var noData = null;
                createTable(passwordTableDiv, contextMenuDiv, noData);
            }
        });

        myResults.on("data", function() {
            var data = myResults.data().results;
            createTable(passwordTableDiv, contextMenuDiv, data);
        });
    }

    function createTable(tableDiv, contextMenuDiv, data) {
        var html = '<p> Click <b>Create</b> to add a user or right click on a row to create, update or delete.</p> \
                    <p><button id="main-create" class="btn btn-primary">Create</button></p>';
        var tdHtml = "";
        var contextMenu = '<ul id="example1-context-menu" class="dropdown-menu"> \
                             <li data-item="update"><a>Update</a></li> \
                             <li data-item="delete"><a>Delete</a></li> \
                           </ul>';
        var header = '<table id="rest-password-table" \
                             class="table table-striped table-hover" \
                             data-toolbar="#toolbar" \
                             data-sort-name="username" \
                             data-show-pagination-switch="true" \
                             data-id-field="id" \
                             data-pagination="true" \
                             data-sortable="true" \
                             data-page-size="10" \
                             data-page-list="[10, 25, 50, 100, ALL]" \
                             data-smart-display="true" \
                             data-search="true" \
                             data-show-footer="false"> \
                      <thead> \
                        <tr> \
                            <th data-field="username" data-sortable="true"><div><h3>Username</h3></div></th> \
                            <th data-field="password" data-events="operateEvents"><div><h3>Password</h3></div></th> \
                            <th data-field="realm" data-sortable="true"><div><h3><h3>Realm</h3></div></th> \
                            <th data-field="app" data-sortable="true"><div><h3>App</h3></div></th> \
                            <th data-field="clear_password" data-visible="false"><div><h3>Clear Password</h3></div></th> \
                            <th data-field="owner" data-sortable="true"><div><h3>Owner</h3></div></th> \
                            <th data-field="acl_read" data-sortable="true"><div><h3>Read</h3></div></th> \
                            <th data-field="acl_write" data-sortable="true"><div><h3>Write</h3></div></th> \
                            <th data-field="acl_sharing" data-sortable="true"><div><h3>Sharing</h3></div></th> \
                        </tr> \
                      </thead> \
                      <tbody>';
        html += header;
        _.each(data, function(row, i) {
            tdHtml += '<tr class="striped"> \
                         <td>' + row.username + '</td> \
                         <td> \
                           <a class="show" href="javascript:void(0)" title="Show Password"> \
                             <li class="icon-visible"></li> \
                           </a> \
                         </td> \
                         <td>' + row.realm + '</td> \
                         <td>' + row.app + '</td> \
                         <td>' + row.clear_password + '</td> \
                         <td>' + row.owner + '</td> \
                         <td>' + row.acl_read + '</td> \
                         <td>' + row.acl_write + '</td> \
                         <td>' + row.acl_sharing + '</td> \
                       </tr>';
        });
        
        tdHtml += "</tbody></table>";
        html += tdHtml;

        $(tableDiv).append(html);
        $(contextMenuDiv).append(contextMenu);
        $('#main-create').on('click', function () { anonCallback(renderCreateUserForm, ["",""])});

        $('#rest-password-table').bootstrapTable({
            contextMenu: '#example1-context-menu',
            onContextMenuItem: function(row, $el){
                if($el.data("item") == "update"){
                    renderUpdateUserForm(row);
                } else if($el.data("item") == "delete"){
                    deleteCredential(row, tableDiv);
                }
            }
        });
    }

    // Callback to refresh window and hide create-user
    function refreshWindow() {
        setTimeout(function () {
            location.reload()
            $('#create-user').show();
        }, 500);
    }

    function deleteCredential(row, tableDiv) {
        var username=Splunk.util.getConfigValue("USERNAME");      
        var url = "/en-US/splunkd/__raw/servicesNS/" + username + "/" + row.app + "/storage/passwords/" + row.realm + ":" + row.username +":";

        var removeUser = function () {
            $.ajax({
                type: "DELETE",
                url: url,
                success: function() {
                    renderModal("user-deleted",
                                "User Deleted",
                                "<p>Successfully deleted user " + row.username + ":" + row.realm + "</p>",
                                "Close",
                                refreshWindow) 
                },
                error: function() {
                    alert("Failed to delete user " + row[0] + ". See console for details");
                }
            });
        }

        var deleteUser = renderModal("user-delete-confirm",
                                     "Confirm Delete Action",
                                     "<p>You're about to remove the user " + row.username + ":" + row.realm + " - Press ok to continue</p>",
                                     "Ok",
                                     removeUser);
    }

    function renderCreateUserForm(cUsername = false, cRealm = false) {
        var getUsersAndApps = function getUsersAndApps() {
            var dfd = $.Deferred();
            if(!usersAndApps) {
                var usersAndApps = new SearchManager({
                    "id": "usersAndApps",
                    "cancelOnUnload": true,
                    "status_buckets": 0,
                    "earliest_time": "-24h@h",
                    "latest_time": "now",
                    "sample_ratio": 1,
                    "search": "| rest /servicesNS/-/-/authentication/users | table title | rename title as user | mvcombine user \
                            | appendcols [| rest /servicesNS/-/-/apps/local | fields title | mvcombine title] \
                            | appendcols [| rest /servicesNS/-/-/apps/local | fields label | mvcombine label]",
                    "app": utils.getCurrentApp(),
                    "auto_cancel": 90,
                    "preview": true,
                    "tokenDependencies": {
                    },
                    "runWhenTimeIsUndefined": false
                }, {tokens: true, tokenNamespace: "submitted"});
            }

            var mainSearch = splunkjs.mvc.Components.getInstance("usersAndApps");
            var myResults = mainSearch.data('results', { output_mode:'json', count:0 });

            mainSearch.on('search:done', function(properties) {
                //document.getElementById("password-table").innerHTML = "";

                if(properties.content.resultCount == 0) {
                    console.log("No Results");
                    var noData = null;
                    //createTable(passwordTableDiv, contextMenuDiv, noData);
                }
            });

            myResults.on("data", function() {
                var data = myResults.data().results;
                //console.log(data);
                dfd.resolve(data);
            });

            return dfd.promise();
        }

        var createUser = function createUser() {
            event.preventDefault();
            console.log(cUsername + cRealm + multiComponent);
            console.log(multiComponent.val());
            var username = $('input[id=createUsername]').val();
            var password = $('input[id=createPassword]').val();
            var confirmPassword = $('input[id=createConfirmPassword]').val();
            var realm = $('input[id=createRealm]').val();
            
            if(username == "") {
                return renderModal("missing-username",
                                    "Missing Username",
                                    "<p>Please enter a username</b>",
                                    "Close",
                                    renderCreateUserForm);
            }

            if(password == "") {
                return renderModal("missing-password",
                                    "Missing Password",
                                    "<p>Please enter a password</b>",
                                    "Close",
                                    renderCreateUserForm);
            }

            var formData = {"name": username,
                            "password": password,
                            "realm": realm};

            console.log(password, confirmPassword);
            if(password != confirmPassword) {
                return renderModal("password-mismatch",
                                    "Password Mismatch",
                                    "<p>Passwords do not match</b>",
                                    "Close",
                                    renderCreateUserForm,
                                    [username, realm]);
            } else {
                var currentUser = Splunk.util.getConfigValue("USERNAME");      
                var app = utils.getCurrentApp();
                var url = "/en-US/splunkd/__raw/servicesNS/" + currentUser + "/" + app + "/storage/passwords";
                
                $.ajax({
                    type: "POST",
                    url: url,
                    data: formData,
                    success: function() {
                        renderModal("user-added",
                                    "User Created",
                                    "<p>Successfully created user " + username + ":" + realm + "</p>",
                                    "Close",
                                    refreshWindow);
                    },
                    error: function(e) {
                        console.log(e);
                        renderModal("user-add-fail",
                                    "Failed User Creation",
                                    "<p>Failed to create user " + username + ":" + realm + "</p><br><p>" + e.responseText + "</p>",
                                    "Close");
                    }
                })
            }
        }

        var html = '<form id="createCredential"> \
                        <div class="form-group"> \
                          <label for="username">Username</label> \
                          <input type="username" class="form-control" id="createUsername" placeholder="Enter username"> \
                        </div> \
                        <p></p> \
                        <div class="form-group"> \
                          <label for="password">Password</label> \
                          <input type="password" class="form-control" id="createPassword" placeholder="Password"> \
                        </div> \
                        <div> \
                          <label for="confirmPassword">Confirm Password</label> \
                          <input type="password" class="form-control" id="createConfirmPassword" placeholder="Confirm Password"> \
                        </div> \
                        <div class="form-group"> \
                          <label for="realm">Realm</label> \
                          <input type="realm" class="form-control" id="createRealm" placeholder="Realm"> \
                          <br></br>\
                        </div> \
                        <div class="form-group"> \
                          <label for="appName">Read Users</label> \
                        </div> \
                        <div id="dropdown-container"></div> \
                    </form>';

        var appSearchString = "| rest /servicesNS/-/-/apps/local | rename title as value | table label, value";
        var userSearchString = "| rest /servicesNS/-/-/authentication/users | eval label=title | rename title as value | table label, value";

        // Remove instance of multi-dropdown if it exists
        var userMultiDropdown = mvc.Components.get("user-multidropdown");
        if(userMultiDropdown) {
            console.log("removing multi");
            userMultiDropdown.remove();
        }

        execSearch(userSearchString, "multi-dropdown")
        .then(function(data) {
            var myModal = renderCreateModal("create-user-form",
                "Create User",
                html);
            myModal.show();

            return {"data": data, "modal":myModal};
        })
        .done(function(res) {
            console.log("creating NEW multi");
            var componentId = "app-multidropdown";
            setTimeout(function () {
                var multiComponent = this.multiComponent = new MultiDropdownView({
                    id: componentId,
                    choices: res.data,
                    labelField: "label",
                    valueField: "value",
                    width: 200,
                    el: $('#dropdown-container')
                }).render();

                res.modal.footer.append($('<button>').attr({
                    type: 'button',
                    'data-dismiss': 'modal'
                }).addClass('btn btn-primary mlts-modal-submit').text("Create").on('click', function () {
                        anonCallback(createUser, [cUsername, cRealm, multiComponent]); 
                    }))
            }, 500);
        });
    
        setTimeout(function () {
            //if(cUsername != "" || (cUsername != "" && cRealm != "")) {
            if(cUsername != "" || cRealm != "") {
                $('input[id=createUsername]').val(cUsername);
                $('input[id=createRealm]').val(cRealm);
            }
        }, 300);
    }

    function renderUpdateUserForm(row) {
        var updateUser = function updateUser () {
            event.preventDefault();
            $('input[id=updateUsername]').val(row.username);
            $('input[id=updateRealm]').val(row.realm);
            $('input[id=updateApp]').val(row.app);

            var username = $('input[id=updateUsername]').val();
            var password = $('input[id=updatePassword]').val();
            var confirmPassword = $('input[id=updateConfirmPassword]').val();
            var realm = $('input[id=updateRealm]').val();
            var app = $('input[id=updateApp]').val();

            var formData = {"password": password};

            if(password == "") {
                return renderModal("password-missing",
                                   "Empty Password",
                                   "<p>Empty password. Please re-enter<p>",
                                   "Close",
                                   renderUpdateUserForm,
                                   [row]);
            }
            if(password != confirmPassword) {
                renderModal("password-mismatch",
                            "Password Mismatch",
                            "<p>Passwords do not match. Please re-enter.<p>",
                            "Close",
                            renderUpdateUserForm,
                            [row]); 
            } else {
                var currentUser = Splunk.util.getConfigValue("USERNAME"); 
                console.log(row);     
                var url = "/en-US/splunkd/__raw/servicesNS/" + currentUser + "/" + app + "/storage/passwords/" + realm + ":" + username;
                console.log(url);
    
                $.ajax({
                    type: "POST",
                    url: url,
                    data: formData,
                    success: function() {
                        renderModal("password-updated",
                                    "Password Updated",
                                    "<p>Password successfully updated for user " + username + ":" + app + "</p>",
                                    "Close",
                                    refreshWindow);
                    },
                    error: function(e) {
                        console.log(e);
                        renderModal("password-updated",
                                    "Password Updated",
                                    "<p>Failed to update password for user " + username + ". " + e.responseText,
                                    "Close",
                                    refreshWindow);
                    }
                });
            }
            //});
        }
        var html = '<form id="updateCredential"> \
                      <div class="form-group"> \
                        <input type="hidden" class="form-control" id="updateUsername"> \
                      </div> \
                      <p></p> \
                      <div class="form-group"> \
                        <label for="password">Password</label> \
                        <input type="password" class="form-control" id="updatePassword" placeholder="Password"> \
                      </div> \
                      <div> \
                        <label for="confirmPassword">Confirm Password</label> \
                        <input type="password" class="form-control" id="updateConfirmPassword" placeholder="Confirm Password"> \
                      </div> \
                      <div> \
                        <input type="hidden" class="form-control" id="updateRealm"> \
                      </div> \
                      <div class="form-group"> \
                        <input type="hidden" class="form-control" id="updateApp"> \
                      </div> \
                    </form>'

        renderModal("update-user-form",
                    "Update User",
                    html,
                    "Update",
                    updateUser);
        
    }

    window.operateEvents = {
        'click .show': function (e, value, row, index) {
            showPassword(row);
        }
    };

    runSearch();

});
