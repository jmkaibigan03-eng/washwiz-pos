<?php
// check_auth.php - Called when the page loads: is a staff member logged in, what is their role,
// and does an admin password exist yet?
require_once 'db.php';
require_once 'auth.php';

// Is anyone logged in right now? (The session decides, not the browser.)
$user = current_user();

// Does at least one Admin account already have a real password?
// If not, the screen shows "Set admin password" instead of the login form.
$role = 'Admin';
$sql = "SELECT password_hash FROM staff WHERE role = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('s', $role);
$stmt->execute();
$admins = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$passwordSet = false;
foreach ($admins as $row) {
    if (is_real_hash($row['password_hash'])) {
        $passwordSet = true;
    }
}

send_success([
    'logged_in'    => ($user !== null),
    'staff_id'     => $user['staff_id'] ?? null,
    'username'     => $user['username'] ?? null,
    'role'         => $user['role'] ?? null,
    'password_set' => $passwordSet,
]);