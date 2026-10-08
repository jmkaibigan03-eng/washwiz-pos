<?php
// set_admin_password.php - Handles BOTH "Set admin password" (first time) and "Change password" (when unlocked).
// The password is turned into a hash with password_hash() and only the hash is saved in staff.password_hash.
require_once 'db.php';
require_once 'auth.php';

require_post();
$input       = get_json_input();
$newPassword = is_string($input['password'] ?? null) ? $input['password'] : '';
$confirm     = is_string($input['confirm_password'] ?? null) ? $input['confirm_password'] : '';

// Check on the server too (the browser's check can be skipped).
if (strlen($newPassword) < 6) {
    send_error('Use at least 6 characters.');
}
if ($newPassword !== $confirm) {
    send_error('Passwords do not match.');
}

$admin = current_admin();
if ($admin !== null) {
    // CHANGE: an Admin is already unlocked, so update that Admin's own password.
    $staffId  = $admin['staff_id'];
    $username = $admin['username'];
} else {
    // SETUP: only allowed while no Admin has a real password yet (the sample rows only have placeholder text).
    $role = 'Admin';
    $sql = "SELECT staff_id, username, password_hash FROM staff WHERE role = ? ORDER BY staff_id";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $role);
    $stmt->execute();
    $admins = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    foreach ($admins as $row) {
        if (is_real_hash($row['password_hash'])) {
            send_error('An admin password already exists. Unlock first, then change it.', 403);
        }
    }
    if (count($admins) === 0) {
        send_error('The staff table has no Admin account.', 500);
    }
    $staffId  = (int) $admins[0]['staff_id'];
    $username = $admins[0]['username'];
}

// password_hash() makes a safe one-way hash. We save the hash, never the password itself.
$newHash = password_hash($newPassword, PASSWORD_DEFAULT);

// Save the hash for that Admin in the staff table.
$sql = "UPDATE staff SET password_hash = ? WHERE staff_id = ?";
$stmt = $conn->prepare($sql);
$stmt->bind_param('si', $newHash, $staffId);
$stmt->execute();
$stmt->close();

// The person who just set the password is now unlocked.
log_in_as($staffId, $username);

send_success(['username' => $username]);