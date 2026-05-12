lines = open('Web_App/html/index.html', encoding='utf-8').readlines()

# Remove lines 464 through 613 (0-indexed: 463-612)
# Line 463 (0-indexed) starts the orphaned content after screen-developers opening
# Line 615 (0-indexed: 614) is the bad backtick comment, line 616 (615) is the real page-header
# We keep line 463 (the screen-developers div opening) and jump to line 615 (page-header)

# Lines to keep: 0-462, then 615 onwards
# But line 463 is the actual <div id="screen-developers"> we want, and line 615 has the bad artifact 

# Let's check: line 463 (0-indexed 462) = <div id="screen-developers" class="screen-content">
# Line 615 (0-indexed 614) = <!-- Developers Screen -->`r`n   <div ...>  (bad artifact line)
# Line 616 (0-indexed 615) = <div class="page-header"> (good content)

# So keep lines 0-463 (0-indexed 0-462), then skip 463-613, jump to 615 (0-indexed 614 is bad, 615 is good)
# Actually: keep up to and including line 463 (index 462 = the opening screen-developers div)
# Then skip until line 616 (index 615 = page-header)

new_lines = lines[:463] + lines[615:]
open('Web_App/html/index.html', 'w', encoding='utf-8').writelines(new_lines)
print(f'Done. Original: {len(lines)} lines, New: {len(new_lines)} lines')
print('Line 463 (kept):', repr(lines[462][:80]))
print('Line 616 (jumped to):', repr(lines[615][:80]))
