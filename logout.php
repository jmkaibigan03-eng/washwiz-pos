<?php
// logout.php - The "Lock" button (and the 10 minute idle lock). It ends the admin session on the server.
require_once 'db.php';
require_once 'auth.php';

require_post();
start_session_once();

$_SESSION = [];       // forget who was logged in
session_destroy();    // delete the session data on the server

send_success();