<?php

function getValue2($request_data, $key, $default = '')
{
    // 检查$key是否存在于$requestData中，如果不存在则返回空字符串
    $value = isset($request_data[$key]) ? $request_data[$key] : $default;
    return $value;
}

$request = array_merge($_GET, $_POST);
$id = getValue2($request, 'id', '');

header("Location: http://azurekiln.cn/link.php?id=$id");
exit();

?>