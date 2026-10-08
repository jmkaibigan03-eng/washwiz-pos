<?php
// auth.php
// Helpers for "who is logged in?". PHP remembers a login in a SESSION (a cookie in the browser + data on the server).
// The browser can pretend to be logged in, but the server checks the session itself.
require_once 'db.php';

// A logged-in staff member who does nothing for this many seconds is logged out (10 minutes).
const SESSION_IDLE_SECONDS = 600;

// Starts the PHP session (only the files that need to know who is logged in call this).
function start_session_once(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        // httponly = JavaScript cannot read the session cookie.
        session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
        session_start();
    }
}

// The sample staff rows only hold placeholder text like 'hash12345'.
// This tells a real password_hash() result apart from that placeholder text.
function is_real_hash(string $hash): bool
{
    $info = password_get_info($hash);
    return !empty($info['algo']);
}

// Returns the logged-in staff member (staff_id, username, role), whether Admin or Cashier.
// Returns null if nobody is logged in or the idle time ran out.
function current_user(): ?array
{
    start_session_once();

    if (empty($_SESSION['staff_id']) || empty($_SESSION['role'])) {
        return null;
    }
    if (time() - ($_SESSION['last_activity'] ?? 0) > SESSION_IDLE_SECONDS) {
        $_SESSION = [];                    // idle for too long: forget the login
        return null;
    }
    $_SESSION['last_activity'] = time();   // activity: the idle timer starts again

    return [
        'staff_id' => (int) $_SESSION['staff_id'],
        'username' => (string) ($_SESSION['username'] ?? ''),
        'role'     => (string) $_SESSION['role'],
    ];
}

// Same as current_user(), but only when that user is an Admin (otherwise null).
function current_admin(): ?array
{
    $user = current_user();
    return ($user !== null && $user['role'] === 'Admin') ? $user : null;
}

// Stops the request unless someone is logged in (any role).
function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        send_error('Please log in first.', 401);
    }
    return $user;
}

// Stops the request unless an Admin is logged in. Every endpoint that changes services calls this first.
function require_admin(): array
{
    $user = require_login();
    if ($user['role'] !== 'Admin') {
        send_error('Admin access only.', 403);
    }
    return $user;
}

// Remembers "this browser is now logged in as this staff member".
// $role defaults to 'Admin' so older code that calls log_in_as($id, $username) keeps working.
function log_in_as(int $staffId, string $username, string $role = 'Admin'): void
{
    start_session_once();
    session_regenerate_id(true);           // new session id after login (protects against session fixation)
    $_SESSION['staff_id']      = $staffId;
    $_SESSION['username']      = $username;
    $_SESSION['role']          = $role;
    $_SESSION['last_activity'] = time();
}

// Which staff member is the order recorded under? (orders.staff_id is required by the schema.)
function current_staff_id(mysqli $conn): int
{
    // If any staff member is logged in (Admin or Cashier), the order is recorded under them.
    $user = current_user();
    if ($user !== null) {
        return $user['staff_id'];
    }

    // Otherwise use the front-desk account: the first Cashier, or the first staff row if there is no Cashier.
    $sql = "SELECT staff_id FROM staff ORDER BY (role = 'Cashier') DESC, staff_id ASC LIMIT 1";
    $stmt = $conn->prepare($sql);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        send_error('There is no staff account in the database, so the order cannot be saved.', 500);
    }
    return (int) $row['staff_id'];
}