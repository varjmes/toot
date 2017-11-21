const express = require('express');
const Entities = require('html-entities').AllHtmlEntities;
const Masto = require('mastodon-api');
const Twit = require('twit');
const app = express();

const M = new Masto({
  access_token: process.env.MASTO_ACCESS_TOKEN,
  timeout_ms:   60*1000,
  api_url:      process.env.MASTO_API_URL,
})
 
const T = new Twit({
  consumer_key:         process.env.TWIT_CONSUMER_KEY,
  consumer_secret:      process.env.TWIT_CONSUMER_SECRET,
  access_token:         process.env.TWIT_ACCESS_TOKEN,
  access_token_secret:  process.env.TWIT_ACCESS_TOKEN_SECRET,
  timeout_ms:           60*1000
})

app.use(express.static('public'));

app.get("/", (request, response) => {
  response.sendFile(__dirname + '/views/index.html');
});

function postTweet (tweet) {
  T.post('statuses/update', { status: tweet, tweet_mode: 'extended'}, (err, data, response) => {
    console.log(tweet)
    console.log(tweet.length)
    if (err) throw err
  })
}

function streamToots () {
  const stream = M.stream('streaming/user');
  const username = process.env.USERNAME;

  stream.on('message', msg => {
    if ((msg.data.account && msg.data.account.username === username)
        && msg.data.in_reply_to_id === null
        && msg.data.in_reply_to_account_id === null
        && msg.data.reblog === null) {
      let originalContent = msg.data.content;
      
      let parsedContent = originalContent.replace(/<\/p>/ig, '\n\n');
      parsedContent = parsedContent.replace(/<p>/ig, "");
      parsedContent = parsedContent.replace(/<br \/>/, "\n\n");

      if (parsedContent.match(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1.+/g)) {
          let [anchor] = parsedContent.match(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1.+/g) || []

          if (anchor) {
              let [href] = anchor.match(/href="([^"]*")/g)
              href = href.replace('href="', '').replace('"', '')
              parsedContent = parsedContent.replace(anchor, href)
          }
      }

      parsedContent = Entities.decode(parsedContent)
      postTweet(parsedContent)
    }
  });

  stream.on('error', err => console.log(err));
}

const listener = app.listen(process.env.PORT, () => {
  console.log('Your app is listening on port ' + listener.address().port);
  streamToots()
});