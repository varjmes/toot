const express = require('express');
const Entities = require('html-entities').AllHtmlEntities;
const Masto = require('mastodon-api');
const Twit = require('twit');
const Sequelize = require('sequelize');
const app = express();

const sequelize = new Sequelize('database', process.env.DB_USER, process.env.DB_PASS, {
  host: '0.0.0.0',
  dialect: 'sqlite',
  pool: {
    max: 5,
    min: 0,
    idle: 10000
  },
    // Security note: the database is saved to the file `database.sqlite` on the local filesystem. It's deliberately placed in the `.data` directory
    // which doesn't get copied if someone remixes the project.
  storage: '.data/database.sqlite'
});

var tweets;
// authenticate with the database
sequelize.authenticate()
  .then(function(err) {
    console.log('Connection has been established successfully.');
    // define a new table 'tweets'
    tweets = sequelize.define('tweets', {
      tweetID: {
        type: Sequelize.STRING
      },
      tootID: {
        type: Sequelize.STRING
      },
      MastodonInstance: {
        type: Sequelize.STRING
      }
    });
    
    setup();
  })
  .catch(function (err) {
    console.log('Unable to connect to the database: ', err);
  });

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

function postTweet (tweet, replyingTo) {
  let options;

  if (replyingTo === null) {
    options = { status: tweet, tweet_mode: 'extended'};
  } else {
    options = { status: tweet, tweet_mode: 'extended', in_reply_to_status_id: replyingTo};
  }
  T.post('statuses/update', options, (err, data, response) => {
    console.log(tweet)
    console.log(tweet.length)
    if (err) throw err
    return response;
  })
}

function findByTweet (tweetID) {
  return new Promise(resolve,reject) => {
    resolve(
      Tweet.findOne({ where: { tweetID: tweetID } })
        .then(tweet => {
          if(tweet.tweetID === null) {
            reject("Tweet not found");
          }
          return tweet
        })
    ).catch((error) => { reject(error) });
  }
}

function findByToot (tootID) {
  return new Promise(resolve,reject) => {
    resolve(
      Tweet.findOne({ where: { tootID: tootID } })
        .then(toot => {
          if(toot.tootID === null) {
            reject("Toot not found");
          }
          return toot
        })
    ).catch((error) => { reject(error) });
  }
}

function formatTweet(content){
  let parsedContent = content.replace(/<\/p>/ig, '\n\n');
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
  return parsedContent;
}

function streamToots () {
  const stream = M.stream('streaming/user');
  const username = process.env.USERNAME;

  let responseTo;
  /**
   * Some assumptions here, assuming that in_reply_to_id is responding to post
   * and in_reply_to_account_id is responding to other account post
   */
  stream.on('message', msg => {

    if ((msg.data.account && msg.data.account.username === username)
        && msg.data.in_reply_to_id === null
        && msg.data.in_reply_to_account_id === null
        && msg.data.reblog === null) {

      let content = formatTweet(msg.data.content);

      let postedTweet = postTweet(content, null)
      Tweet.sync().then(() => {
        return Tweet.Create({
          tweetID: postedTweet.id,
          tootID: msg.data.id,
          mastodonInstance: process.env.INSTANCE
        })
      });
    } else if((msg.data.account && msg.data.account.username === username)
              && (msg.data.in_reply_to_id != null)
              && msg.data.reblog === null) {
      findByToot(msg.data.in_reply_to_id).then((toot)=>{
        let content = formatTweet(msg.data.content);

        let postedTweet = postTweet(content, toot.tweetID)
        Tweet.sync().then(() => {
          return Tweet.Create({
            tweetID: postedTweet.id,
            tootID: msg.data.id,
            mastodonInstance: process.env.INSTANCE
          })
        });
      }).catch(error => console.log(error));
    }
  });

  stream.on('error', err => console.log(err));
}

const listener = app.listen(process.env.PORT, () => {
  console.log('Your app is listening on port ' + listener.address().port);
  streamToots()
});
