'use strict';

require(['jquery',
        'underscore',
        'splunkjs/mvc',
        'splunkjs/mvc/utils',
        'splunkjs/mvc/tokenutils',
        'splunkjs/mvc/messages',
        'splunkjs/mvc/searchmanager',        
        '/static/app/TA-zenoss/Modal.js',
        'splunkjs/mvc/simpleform/input/dropdown',
        'splunkjs/mvc/simplexml/ready!'],
function ($,
          _,
          mvc,
          utils,
          TokenUtils,
          Messages,
          SearchManager,
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

    function renderModal(id, title, body, buttonText, callback=function(){}, callbackArgs=null) {
        var myModal = new Modal(id, {
                    title: title,
                    destroyOnHide: true,
                    type: 'normal'
        }); 

        var hold = function () {
            if(reload == true) {
                location.reload();
            }
            console.log("returning");
            return true;
        }

        // $(myModal.$el).on("hide", function(){
            // Not taking any action on hide, but you can if you want to!
        // })
    
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

        var search1 = new SearchManager({
                "id": "search1",
                "cancelOnUnload": true,
                "status_buckets": 0,
                "earliest_time": "-24h@h",
                "latest_time": "now",
                "sample_ratio": 1,
                "search": "| rest /services/storage/passwords \
                           | table username, password, realm, clear_password, eai:acl.app \
                           | rename eai:acl.app as app",
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
        var createUser = function createUser() {
            event.preventDefault();
            console.log(cUsername + cRealm);
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
                      </form>'

        renderModal("create-user-form",
            "Create User",
            html,
            "Create",
            createUser,
            [cUsername, cRealm]);
    
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
