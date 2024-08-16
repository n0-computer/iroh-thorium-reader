# iroh-thorium

This is a fork of [Thorium Reader](https://www.edrlab.org/software/thorium-reader/) that adds iroh integration for fetching ePub URLs. Currently just a proof-of-concept

To run this you will need:
- 

## Setup
- clone this repo & `cd iroh-thorium-reader`
- `npm install`
- `npm run start:dev`
- once the app is open:
    - click to “all publications” section
    - click `download publication`
    - paste in any link that points to an ePub URL. As an example: https://www.gutenberg.org/ebooks/67979.epub3.images
    - scan output logs for "irohFetch" messages to see if book was fetched from HTTP or iroh
    - pasting the same link a second time will always fetch from iroh

## TODO
* Add instructions for sending metrics telemetry to a prometheus pushGateway