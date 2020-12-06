all: public/index.xhtml public/script.js public/style.css

public/index.xhtml: public/ index.xhtml
	cat index.xhtml | tr '[:space:]' ' ' | tr -s ' ' | sed 's/> </></g' > $@

public/script.js: public/ script.js
	terser --compress --mangle < script.js > $@

public/style.css: public/ style.css
	cat style.css | tr '[:space:]' ' ' | tr -s ' ' > $@

public/:
	mkdir -p $@
