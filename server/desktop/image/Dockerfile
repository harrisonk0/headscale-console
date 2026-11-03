FROM alpine:3.22 AS icewm-build
RUN apk add --no-cache build-base lzip wget ca-certificates libx11-dev libxext-dev libxft-dev libxrandr-dev libxinerama-dev libxrender-dev libxcomposite-dev libxcursor-dev libxdamage-dev libxfixes-dev libsm-dev libice-dev libxpm-dev libpng-dev libjpeg-turbo-dev fontconfig-dev freetype-dev
RUN wget -q https://github.com/ice-wm/icewm/releases/download/4.1.0/icewm-4.1.0.tar.lz -O /tmp/icewm.tar.lz && \
    mkdir /src && lzip -dc /tmp/icewm.tar.lz | tar -xf - -C /src --strip-components=1 && \
    cd /src && ./configure --prefix=/usr --without-icesound --disable-nls --disable-librsvg --disable-nanosvg --disable-fribidi --disable-menus-fdo --disable-imlib2 --disable-gdk-pixbuf && \
    make -j2 && make DESTDIR=/stage install
FROM alpine:3.22
RUN apk add --no-cache alpine-base eudev udev-init-scripts-openrc \
    xorg-server xf86-input-libinput xrandr xev dbus dbus-openrc \
    libstdc++ libx11 libxext libxft libxrandr libxinerama libxrender libxcomposite libxcursor libxdamage libxfixes libsm libice libxpm libpng libjpeg-turbo fontconfig freetype xterm mc font-dejavu bash nano vim sudo curl \
    openssh-client tigervnc-client freerdp python3 ca-certificates
RUN rc-update add bootmisc boot && rc-update add udev sysinit && \
    rc-update add udev-trigger sysinit && rc-update add udev-settle sysinit && \
    rc-update add udev-postmount default && rc-update add dbus default
RUN adduser -D -s /bin/bash user && passwd -l root && \
    addgroup user wheel && printf '%%wheel ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/hk-guest && \
    chmod 440 /etc/sudoers.d/hk-guest && mkdir -p /home/user/.icewm /var/lib/hk-remote
COPY --from=icewm-build /stage/ /
COPY icewm/ /home/user/.icewm/
RUN chown -R user:user /home/user
CMD ["/usr/bin/icewm-session"]
