# Password Manager

## About

The password manager app provides a Javascript CRUD interface to the [Splunk storage/passwords REST endpoint](http://docs.splunk.com/Documentation/Splunk/7.0.3/RESTREF/RESTaccess#storage.2Fpasswords). 

## Dependencies
To store passwords the user must have the `admin_all_objects` capability enabled within an assigned role. To read passwords a user must have `list_storage_passwords` capabilty enabled within an assigned role.

## Usage
The Credential Management dashboard provides a CRUD interface to create, update and delete credentials to be used within Splunk apps. 

#### Create Credential
Simply click the create button to reveal the credential creation form.

![Alt text](docs/credential-create.png?raw=true)

![Alt text](docs/create-form.png?raw=true)


Once created, the dashboard will be refreshed automatically. You can right click on a table entry to reveal a context menu that allows you to update or delete the credential. You can alternately click the detail view (plus icon) in the table to update the credential. Select any individual credential or multi-select using the checkbox in the header column and press the delte button. You can also click the eye icon to view the plain text password.

#### Password Storage
Use the provided dashboard to store passwords within the Password Manager app context only. At this time, the dashboard does not allow you to specify what app context you'd like to store the credentials in. If you'd like to store passwords within another app context, simply `cp -R $SPLUNK_HOME/etc/apps/password-manager/appserver/static $SPLUNK_HOME/etc/apps/<some_other_app>/appserver` and clone the Credential Management dashboard within that app.

#### Password Management
Any app that has global permissions set will expose their passwords within the Credential Management dashboard of the Password Management app. You can list, update and delete any of those passwords within the Password Manager app.

## To-Do
Allow the user to pick the app context they'd like to store the password in from within the Password Manager app.
