<?php
// db.php
// The ONE place that connects PHP to MySQL. Every other PHP file starts with:  require_once 'db.php';
// It also holds a few tiny helpers that all endpoints share (sending JSON answers, reading the request).

// Every PHP file in this project answers with JSON, so we say so before anything else.
header('Content-Type: application/json; charset=utf-8');

// ---- Connection settings (change them if your MySQL login is different) ----
$host     = 'localhost';
$user     = 'root';
$password = '';            // XAMPP's default root password is empty
$database = 'washwiz_db';

// The finished schema has no settings table, so the home delivery fee is kept here, in ONE place.
// PHP uses this value when it calculates an order. The browser cannot change it.
define('DEFAULT_DELIVERY_FEE', 50.00);

// Use the shop's time zone, so "today" (created date, payment date) is the Philippine date.
date_default_timezone_set('Asia/Manila');

// Never print PHP errors into the response (they would break the JSON). They go to the PHP error log instead.
ini_set('display_errors', '0');

// Make mysqli throw an exception when a query fails, so we can use try/catch and ROLLBACK.
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

// ---- Small helpers used by all endpoints ----

// Sends a JSON answer and stops the script.
function send_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

// Success answer:  { "success": true, "data": ... }
function send_success($data = null): void
{
    send_json(['success' => true, 'data' => $data]);
}

// Error answer:  { "success": false, "message": "..." }  (the message is safe to show to the user)
function send_error(string $message, int $status = 400): void
{
    send_json(['success' => false, 'message' => $message], $status);
}

// Stops the script unless the browser used POST (every "change data" endpoint needs POST).
function require_post(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        send_error('This action must be sent with POST.', 405);
    }
}

// Reads the JSON body that app.js sends with fetch().
function get_json_input(): array
{
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        send_error('The request was not valid JSON.', 400);
    }
    return $data;
}

// Turns any input value into trimmed text (arrays and other odd values become an empty string).
function clean_text($value): string
{
    return is_scalar($value) ? trim((string) $value) : '';
}

// If anything unexpected goes wrong, save the technical details in the log and show the user a simple message.
set_exception_handler(function (Throwable $e) {
    error_log('WashWiz error: ' . $e->getMessage());
    send_error('Something went wrong on the server. Please try again.', 500);
});

// ---- Connect to MySQL ----
try {
    $conn = new mysqli($host, $user, $password, $database);
    $conn->set_charset('utf8mb4');   // so names like "Peña" are saved correctly
} catch (mysqli_sql_exception $e) {
    error_log('WashWiz connection error: ' . $e->getMessage());
    send_error('Cannot connect to the database. Is MySQL running, and is washwiz_db imported?', 500);
}