<?php
// Run with php -n so doubles never replace a loaded curl extension.
if (extension_loaded('curl')) {
    fwrite(STDERR, "Run this offline test using php -n.\n");
    exit(1);
}
foreach (array('CURLOPT_RETURNTRANSFER', 'CURLOPT_HTTPGET', 'CURLOPT_HTTPHEADER', 'CURLOPT_CONNECTTIMEOUT',
    'CURLOPT_TIMEOUT', 'CURLOPT_FOLLOWLOCATION', 'CURLOPT_PROTOCOLS', 'CURLPROTO_HTTPS',
    'CURLOPT_SSL_VERIFYPEER', 'CURLOPT_SSL_VERIFYHOST', 'CURLINFO_HTTP_CODE') as $i => $constant) {
    define($constant, $i + 1);
}
$calls = 0;
$responseStatus = 200;
$responseBody = '[]';
$options = array();
function curl_init($url) { $GLOBALS['calls']++; return new stdClass(); }
function curl_setopt_array($handle, $options) { $GLOBALS['options'] = $options; return true; }
function curl_exec($handle) { return $GLOBALS['responseBody']; }
function curl_getinfo($handle, $key) { return $GLOBALS['responseStatus']; }
function curl_close($handle) {}
require __DIR__ . '/../../docs/php/FormosaProxyConnection.php';
class FormosaProxyFixture { use FormosaProxyConnection; }
$client = new FormosaProxyFixture();
$checks = 0;
function check($condition, $message) {
    $GLOBALS['checks']++;
    if (!$condition) { fwrite(STDERR, $message . "\n"); exit(1); }
}
$failure = array('statusCode' => 502, 'error' => 'formosa_proxy_failed');
putenv('FORMOSA_PROXY_TOKEN=fixture-token');
foreach (array('', 'http://example.test/api/formosa', 'https://user:pass@example.test/api/formosa',
    'file:///tmp/formosa', 'https://example.test/api/formosa#fragment') as $badUrl) {
    putenv('FORMOSA_PROXY_URL=' . $badUrl);
    check($client->connectApiProtocol() === $failure, 'Invalid URL must fail safely');
}
check($calls === 0, 'Invalid configuration must not call curl');
putenv('FORMOSA_PROXY_URL=https://proxy.example.test/api/formosa');
putenv('FORMOSA_PROXY_TOKEN');
check($client->connectApiProtocol() === $failure, 'Missing token must fail');
putenv('FORMOSA_PROXY_TOKEN=fixture-token');
check($client->connectApiProtocol() === array(), 'A genuine empty array is a valid success');
check(in_array('Authorization: Bearer fixture-token', $options[CURLOPT_HTTPHEADER], true), 'Bearer header');
check($options[CURLOPT_SSL_VERIFYPEER] === true && $options[CURLOPT_SSL_VERIFYHOST] === 2, 'TLS verification');
check($options[CURLOPT_PROTOCOLS] === CURLPROTO_HTTPS && $options[CURLOPT_FOLLOWLOCATION] === false, 'HTTPS and no redirects');
foreach (array(301, 401, 403, 429, 500, 502, 503, 504) as $status) {
    $responseStatus = $status;
    check($client->connectApiProtocol() === $failure, 'Non-200 must preserve existing data');
}
$responseStatus = 200;
foreach (array(false, '<html>private-error-detail</html>', '{"statusCode":502}', '{}', 'null', '[invalid]', '[{}]', '[1]') as $body) {
    $responseBody = $body;
    check($client->connectApiProtocol() === $failure, 'Invalid JSON/schema must fail');
}
$tour = array('mainid' => 'JP-001', 'title' => 'ญี่ปุ่น 🗾', 'banner' => '', 'pdf' => '', 'doc' => '',
    'tour_day' => 5, 'tour_night' => 3, 'flights' => array(array('flight_direction' => 'depart',
    'from_airport' => 'BKK', 'to_airport' => 'KIX', 'flight_no' => 'TG622', 'depart_time' => '08:00', 'arrive_time' => '16:00')),
    'period' => array(array('tour_period' => '1–5 มกราคม', 'price' => '25900', 'price_old' => '29900',
    'Chd+B' => '', 'ChdNB' => '', 'single' => '', 'size' => '30', 'Book' => '10', 'AVBL' => '20', 'comOffice' => '1000', 'comSale' => '500')));
$responseBody = json_encode(array($tour));
check($client->connectApiProtocol() === array($tour), 'Success returns original schema including Thai and emoji');
$invalid = $tour;
$invalid['period'][0]['price'] = null;
$responseBody = json_encode(array($tour, $invalid));
check($client->connectApiProtocol() === $failure, 'No partially valid list');
echo "PHP offline checks passed: " . $checks . "\n";
