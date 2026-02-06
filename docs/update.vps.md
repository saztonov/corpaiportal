Шаг 2. Переключение на пользователя wstil
От имени: root


su - wstil

Шаг 3. Сохранить текущие .env файлы (бэкап)
От имени: wstil

cp ~/corpaiportal/.env.local ~/env-backup-frontend.txt
cp ~/corpaiportal/proxy/.env ~/env-backup-proxy.txt
Примечание: ~/corpaiportal — это симлинк или полный путь /var/www/wstil/data/corpaiportal. Проверьте, что путь корректный:

ls -la ~/corpaiportal/
Если ~/corpaiportal не существует, используйте полный путь:

cd /var/www/wstil/data/corpaiportal

Шаг 4. Остановить прокси-сервер
От имени: wstil
pm2 stop corpai-proxy

Шаг 5. Сменить remote-репозиторий на новый
От имени: wstil
cd /var/www/wstil/data/corpaiportal
# Посмотреть текущий remote
git remote -v
# Сменить URL на новый репозиторий
git remote set-url origin https://github.com/saztonov/corpaiportal.git
# Проверить, что сменился
git remote -v

Шаг 6. Получить код из нового репозитория
От имени: wstil


cd /var/www/wstil/data/corpaiportal

# Скачать все данные из нового репозитория
git fetch origin
git pull origin main




# Принудительно обновить код до состояния нового репозитория
git reset --hard origin/main
Если ветка называется не main, а master, замените origin/main на origin/master.

Шаг 7. Восстановить .env файлы
От имени: wstil

cp ~/env-backup-frontend.txt /var/www/wstil/data/corpaiportal/.env.local
cp ~/env-backup-proxy.txt /var/www/wstil/data/corpaiportal/proxy/.env
Если .env файлы не менялись и остались на месте после git reset (они в .gitignore), этот шаг можно пропустить. Проверьте:


cat /var/www/wstil/data/corpaiportal/.env.local
cat /var/www/wstil/data/corpaiportal/proxy/.env

Шаг 8. Обновить зависимости и собрать прокси-сервер
От имени: wstil


cd /var/www/wstil/data/corpaiportal/proxy
npm install
npm run build
Шаг 9. Запустить прокси-сервер
От имени: wstil


pm2 restart corpai-proxy
Если процесс corpai-proxy был удалён, создать заново:


cd /var/www/wstil/data/corpaiportal/proxy
pm2 start dist/index.js --name corpai-proxy
pm2 save
Проверить статус:


pm2 status
pm2 logs corpai-proxy --lines 20
Шаг 10. Обновить зависимости и собрать фронтенд
От имени: wstil


cd /var/www/wstil/data/corpaiportal
npm install
npm run build
Шаг 11. Скопировать собранный фронтенд в директорию Nginx
От имени: wstil


# Очистить старые файлы
rm -rf /var/www/wstil/data/www/aihub.fvds.ru/*

# Скопировать новую сборку
cp -r /var/www/wstil/data/corpaiportal/dist/* /var/www/wstil/data/www/aihub.fvds.ru/
Шаг 12. Перезагрузить Nginx (если нужно)
От имени: root (выйти из wstil через exit)


exit
nginx -t
systemctl reload nginx
nginx -t проверяет конфигурацию. Если конфиг Nginx не менялся, перезагрузка необязательна — статические файлы подхватятся автоматически. Но reload безопасен и не прерывает работу.

Шаг 13. Проверка работоспособности
От имени: root (или wstil)


# Проверить что прокси работает
curl -s http://localhost:3001/api/v1/models | head -c 200

# Проверить что Nginx отдаёт фронтенд
curl -s -o /dev/null -w "%{http_code}" https://aihub.fvds.ru

# Проверить логи прокси на ошибки
su - wstil -c "pm2 logs corpai-proxy --lines 30 --nostream"
Также открыть в браузере: https://aihub.fvds.ru и проверить:

Загружается ли страница входа
Работает ли авторизация
Работает ли чат с AI
Быстрая справка: Полный скрипт одной командой
Если всё понятно и хочется выполнить быстро, вот сокращённая версия от имени wstil:


cd /var/www/wstil/data/corpaiportal && \
git remote set-url origin https://github.com/saztonov/corpaiportal.git && \
git fetch origin && \
git reset --hard origin/main && \
cd proxy && npm install && npm run build && \
pm2 restart corpai-proxy && \
cd /var/www/wstil/data/corpaiportal && npm install && npm run build && \
rm -rf /var/www/wstil/data/www/aihub.fvds.ru/* && \
cp -r dist/* /var/www/wstil/data/www/aihub.fvds.ru/
Затем от имени root:


nginx -t && systemctl reload nginx
