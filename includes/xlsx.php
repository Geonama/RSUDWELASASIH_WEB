<?php

function xlsx_column_name(int $index): string
{
    $name = '';
    while ($index > 0) {
        $index--;
        $name = chr(65 + ($index % 26)) . $name;
        $index = intdiv($index, 26);
    }
    return $name;
}

function xlsx_cell(string $value, int $row, int $column): string
{
    $ref = xlsx_column_name($column) . $row;
    $escaped = htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    return '<c r="' . $ref . '" t="inlineStr"><is><t>' . $escaped . '</t></is></c>';
}

function xlsx_sheet_xml(array $rows): string
{
    $xmlRows = [];
    foreach ($rows as $rowNumber => $row) {
        $cells = [];
        foreach (array_values($row) as $columnIndex => $value) {
            $cells[] = xlsx_cell((string) $value, $rowNumber + 1, $columnIndex + 1);
        }
        $xmlRows[] = '<row r="' . ($rowNumber + 1) . '">' . implode('', $cells) . '</row>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' .
        '<sheetData>' . implode('', $xmlRows) . '</sheetData></worksheet>';
}

function send_xlsx(string $filename, array $rows): never
{
    $filename = substr(preg_replace('/[^A-Za-z0-9_.-]/', '_', $filename), 0, 180);
    if (!class_exists(ZipArchive::class)) {
        http_response_code(500);
        echo 'Ekstensi ZIP PHP belum aktif.';
        exit;
    }

    $tmp = tempnam(sys_get_temp_dir(), 'etransit_xlsx_');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);

    $zip->addFromString('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' .
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' .
        '<Default Extension="xml" ContentType="application/xml"/>' .
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' .
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' .
        '</Types>'
    );
    $zip->addFromString('_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' .
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' .
        '</Relationships>'
    );
    $zip->addFromString('xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' .
        '<sheets><sheet name="Rekap E-Transit" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    $zip->addFromString('xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' .
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' .
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' .
        '</Relationships>'
    );
    $zip->addFromString('xl/worksheets/sheet1.xml', xlsx_sheet_xml($rows));
    $zip->close();

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($tmp));
    readfile($tmp);
    unlink($tmp);
    exit;
}
