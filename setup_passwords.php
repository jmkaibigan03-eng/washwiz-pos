<?php
// setup_passwords.php - Runs once to securely encrypt staff passwords
require_once 'db.php';

$passwords = [
    'admin_owner'     => 'admin123456',
    'staff_alyssa'    => 'alyssa123456',
    'staff_stephanie' => 'stephanie123456',
    'staff_arcer'     => 'arcer123456',
    'staff_francis'   => 'francis123456',
    'staff_jasper'    => 'jasper123456',
    'staff_jade'      => 'jade123456',
    'staff_aika'      => 'aika123456'
];

foreach ($passwords as $username => $plain_password) {
    // Generate the secure bcrypt hash
    $hash = password_hash($plain_password, PASSWORD_DEFAULT);
    
    // Update the database
    $sql = "UPDATE staff SET password_hash = ? WHERE username = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('ss', $hash, $username);
    $stmt->execute();
}

echo "<h2 style='font-family: sans-serif; color: #166534;'>Success!</h2>";
echo "<p style='font-family: sans-serif;'>All passwords have been securely encrypted and updated in the database.</p>";
echo "<p style='font-family: sans-serif;'>You can now test the login screen using <b>staff_jade</b> and <b>jade123456</b>.</p>";
?>