-- Hearth launcher: opens the dashboard, starting the server first if it is not running.
property repoPath : "~/code/alex-quiterio/hearth"
property bunPath : "/opt/homebrew/bin/bun"
property hearthURL : "http://127.0.0.1:4747"
property logPath : "~/Library/Logs/hearth.log"

on isUp()
	try
		do shell script "curl -s -o /dev/null --max-time 1 " & hearthURL
		return true
	on error
		return false
	end try
end isUp

if not isUp() then
	-- Apps launched from Finder get a bare PATH; skills need obsidian, python3 and friends.
	-- Run from the repo so Bun loads .env, and detach fully so this launcher returns at once.
	do shell script "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin\"; cd " & repoPath & " && (nohup " & bunPath & " src/server.ts >> " & logPath & " 2>&1 < /dev/null &)"
	repeat 40 times
		delay 0.25
		if isUp() then exit repeat
	end repeat
	if not isUp() then
		display dialog "Hearth did not start. See " & logPath buttons {"OK"} default button 1 with icon caution
		return
	end if
end if
open location hearthURL
