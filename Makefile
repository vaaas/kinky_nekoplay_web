all: public/index.xhtml public/script.js public/style.css

public/index.html: public/ index.xhtml
    cp index.xhtml public/

public/script.js: public/ script.js
    cp script.js public/

public/style.css: public/ style.css
    cp style.cp public/

public/:
    mkdir -p $@
