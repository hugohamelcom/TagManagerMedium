# TagManagerMedium

Source: https://omr.ruhr/tag-manager-for-medium-improve-seo-and-more-39f1812ca0dd

Tag Manager for Medium — Improve SEO and more
Advanced tracking options for your Medium blog in a couple of minutes

Finally you can deploy Tag Manager
Not directly, though. We will need the help of a very big yet great company. This company is Cloudflare which recently introduced its Workers product that allows you to modify client requests and server responses basically in real-time while traversing through the Cloudflare infrastructure. If you need one more reason to put your web propety behind Cloudflare, the Workers option makes a great one!

Make sure to edit the TAG_MANAGER constant to contain your snippet. Your Medium blog will then have your container snippet embedded and you can do whatever Tag Manager magic comes to your mind.

How it works
The script simply parses through Medium’s HTML body and looks for the string ‘</head>’. Once found, it will inject your Tag Manager snippet before writing the response to the client.

I have to say that this script is just a modification of the far more complex script provided by Cloudflare’s Patrick Meenan to use Workers to improve performance of Google Fonts, so I don’t take any credit for that. Just cut it a bit down to simply deliver Tag Manager which hopefully can serve as one more inspiration to use Workers in your marketing tech stack.
