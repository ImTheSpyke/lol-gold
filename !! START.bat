@echo off
call npm i
call npm run build
call npm run start


echo.
echo Program stopped. If there is an error above please make sure you have installed Node.js version 26 or above
echo.
pause