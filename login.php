<?php
// login.php - Staff login. It checks the typed username and password against the staff table.
// Passwords are never stored as plain text: we only compare with password_verify().
require_once 'db.php';
require_once 'auth.php';

require_post();
$input         = get_json_input();
$typedUsername = is_string($input['username'] ?? null) ? trim($input['username']) : '';
$typedPassword = is_string($input['password'] ?? null) ? $input['password'] : '';   // not trimmed on purpose

if ($typedUsername === '' || $typedPassword === '') {
    send_error('Username and password are required.', 400);
}

start_session_once();

// Too many wrong tries? Make the person wait (5 tries, then 30 seconds).
$lockedUntil = $_SESSION['lock_until'] ?? 0;
if ($lockedUntil > time()) {
    send_error('Too many attempts. Try again in ' . ($lockedUntil - time()) . ' seconds.', 429);
}

// Find the staff member with this username (any role: Admin or Cashier).
$sql = "SELECT staff_id, username, role, password_hash FROM staff WHERE username = ? LIMIT 1";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $typedUsername);
$stmt->execute();
$staff = $stmt->get_result()->fetch_assoc();
$stmt->close();

// password_verify() compares the typed password with the saved hash.
$valid = $staff !== null
    && is_real_hash($staff['password_hash'])
    && password_verify($typedPassword, $staff['password_hash']);

if (!$valid) {
    $_SESSION['login_fails'] = ($_SESSION['login_fails'] ?? 0) + 1;
    if ($_SESSION['login_fails'] >= 5) {
        $_SESSION['login_fails'] = 0;
        $_SESSION['lock_until']  = time() + 30;
        send_error('Too many attempts. Wait 30 seconds.', 429);
    }
    // One message for both cases, so nobody can tell whether the username exists.
    send_error('Wrong username or password.', 401);
}

// Correct login: remember this browser as this staff member (staff_id, username, role).
log_in_as((int) $staff['staff_id'], $staff['username'], $staff['role']);
$_SESSION['login_fails'] = 0;

send_success([
    'staff_id' => (int) $staff['staff_id'],
    'username' => $staff['username'],
    'role'     => $staff['role'],
]);