/*
 * @Author: Cleverson Puche, Leandro Schmitt & Bruno Machado
 * @Date: 2017-09-15 08:41:25
 */
var jwt = require('ozairjr/jwt')
var urlParser = require('url-parser')

/**
* @description
* Module for authentication and authorization
*/
var Auth = function () {
    var DEFAULT_ACCESS_TOKEN_TTL = 5 * (1000 * 60) // 5m
    var DEFAULT_REFRESH_TOKEN_TTL = 8 * (1000 * 60 * 60) // 8h

    var self = this
    var authAuthorizations
    var authNotAuthenticatedUrls
    var authCanRefreshTokenFn
    var authAuthorizeFn
    var authUseSecureAuthentication = false

    var authAccessTokenTTL = {
        default: DEFAULT_ACCESS_TOKEN_TTL
    }

    var authRefreshTokenTTL = {
        default: DEFAULT_REFRESH_TOKEN_TTL
    }

    /**
    * Método utilizado para definir se a autenticação será segura ou não.
    * @example
    * @file startup.js
    * @code auth.useSecureAuthentication(true)
    */
    this.useSecureAuthentication = function (useSecure) {
        authUseSecureAuthentication = useSecure
        return self
    }

    /**
    * Método utilizado para setar o objeto de autorizações.
    * @example
    * @file startup.js
    * @code auth.authorizations({})
    */
    this.authorizations = function (auths) {
        authAuthorizations = urlParser.buildUrlRules(auths)
        return self
    }

    /**
      * Função que pode ser adicionada ao auth para substituir a função padrão de autenticação.
      * @example
      * @file startup.js
      * @code
      * auth.authorizeFn(function(request, url, urlRoles, userData))
      */
    this.authorizeFn = function (authorizeFn) {
        authAuthorizeFn = authorizeFn
        return self
    }

    /**
    * Método utilizado para setar as URLs que não necessitam de autenticação.
    * @example
    * @file startup.js
    * @code auth.notAuthenticatedUrls([])
    */
    this.notAuthenticatedUrls = function (urls) {
        if (urls) {
            authNotAuthenticatedUrls = typeof urls === 'string' ? [urls] : urls
            authNotAuthenticatedUrls = urlParser.buildUrlRules(authNotAuthenticatedUrls)
        }

        return self
    }

    /**
      * Método utilizado para setar as URLs que não necessitam de autenticação.
      * @example
      * @file startup.js
      * @code auth.notAuthenticatedUrls([])
      */
    this.addNotAuthenticatedUrls = function (urls) {
        if (urls) {
            urls = typeof urls === 'string' ? [urls] : urls
            authNotAuthenticatedUrls = authNotAuthenticatedUrls.concat(urlParser.buildUrlRules(urls))
        }

        return self
    }

    this.getNotAuthenticatedUrls = function () {
        return authNotAuthenticatedUrls
    }

    this.clearNotAuthenticatedUrls = function (urls) {
        authNotAuthenticatedUrls = []

        return self
    }

    /**
    * Método utilizado para setar a expiração do token.
    * Pode ser passado como argumento apenas o tempo, que então mudará o default, ou passar junto com um nome de aplicação, que configurará apenas para esta.
    * @example
    * @file startup.js
    * @code
        auth.accessTokenTTL(16000); //Mudando default
        auth.accessTokenTTL('meuApp', 16000); Mudando por aplicação
    */
    this.accessTokenTTL = function (app, ttl) {
        if (arguments.length === 1) {
            ttl = app
            app = 'default'
        }

        authAccessTokenTTL[app] = ttl

        return self
    }

    /**
    * Método utilizado para setar a expiração do refresh de token.
    * Pode ser passado como argumento apenas o tempo, que então mudará o default,
    * ou passar junto com um nome de aplicação, que configurará apenas para esta.
    * @example
    * @file startup.js
    * @code
          auth.refreshTokenTTL(16000); //Mudando default
          auth.refreshTokenTTL('meuApp', 16000); Mudando por aplicação
    */
    this.refreshTokenTTL = function (app, ttl) {
        if (arguments.length === 1) {
            ttl = app
            app = 'default'
        }

        authRefreshTokenTTL[app] = ttl

        return self
    }

    /**
     * Método utilizado para setar uma função que irá validar se um token pode ser renovado.
     * Por padrão os token podem ser renovados.
     * @example
     * @file startup.js
     * @code auth.canRefreshTokenFn(function(token) {return true;})
     */
    this.canRefreshTokenFn = function (canRefreshFn) {
        authCanRefreshTokenFn = canRefreshFn
        return self
    }

    /**
  * Middleware que deve ser usado para ativar o módulo
  * @example
  * @file startup.js
  * @code auth.addMiddleware(auth) //Nota: É recomendável que seja o primeiro middleware da aplicação
  */
    this.middleware = function (params, request, response) {
        if (!isAuthenticatedUrl(request.requestURI)) {
            return true
        }

        try {
            proccessAndValidateToken(params, request, response)
            return true
        } catch (error) {
            print(error)
            notAuthenticated(response)
            return false
        }
    }

    /**
    * Função que pode ser utilizada em um middleware, apenas para validar a autorização, vide exemplo de autorização sem autenticação acima.
    * @example
    * @file startup.js
    * @code
    * auth.validateOnlyAuthorization(params, request, response, userData)
    */
    this.validateOnlyAuthorization = function (params, request, response, userData) {
        try {
            if (!isAuthorized(request, userData)) {
                throw new Error('Authorization Error: You are not allowed to access this resource.')
            }

            return true
        } catch (error) {
            print(error)
            notAuthenticated(response) // 3303-7800
            return false
        }
    }

    /**
  * Cria um token de autenticação e o adiciona em um cookie, no header da resposta
  * @param {Object} params - Parâmetros da requisição
  * @param {Object} request - Request da requisição
  * @param {Object} response - Response da requisição
  * @param {Object} userId - Id do usuário
  * @param {Object} appId - Id da aplicação (nota: uma aplicação pode conter vários ids)
  * @param {Object} data - Dados que serão incluídos no token e disponibilizados em 'request.userData'
  * @example
  * @file login-endpoint.js
  * @code authentication.createAuthentication(params, request, response, 341, 'mobileApp1', {profile: 'admin'})
  */
    this.createAuthentication = function (params, request, response, userId, appId, data) {
        var expires = new Date().getTime() + getAccessTokenTTL(appId)

        var tkn = jwt.serialize({
            exp: expires,
            iss: appId,
            rtexp: new Date().getTime() + getRefreshTokenTTL(appId),
            udata: {
                app: appId,
                sub: userId,
                data: data
            }
        }, true)

        setTokenIntoHeader(params, request, response, tkn)

        return tkn
    }

    /**
    * Destrói um autenticação caso ele exista
    * @param {Object} params - Parâmetros da requisição
    * @param {Object} request - Request da requisição
    * @param {Object} response - Response da requisição
    * @example
    * @file logout-endpoint.js
    * @code authentication.destroyAuthentication(params, request, response)
    */
    this.destroyAuthentication = function (params, request, response) {
        setTokenIntoHeader(params, request, response, 'undefined')
    }

    function isAuthorized (request, userData) {
        if (!authAuthorizations) {
            return true
        }

        var userRoles = userData && userData.roles

        if (!authAuthorizeFn && !userRoles) {
            return true
        }

        if (typeof userRoles === 'string') {
            userRoles = [userRoles]
        }

        return urlParser.urlMatches(authAuthorizations, request.requestURI, function (urlRule) {
            if (authAuthorizeFn) {
                return authAuthorizeFn(request, request.requestURI, urlRule.data, userData, urlRule)
            } else {
                return urlRule.data.some(function (role) {
                    return userRoles.indexOf(role) > -1
                })
            }
        })
    }

    function isAuthenticatedUrl (requestURI) {
        return !authNotAuthenticatedUrls || !urlParser.urlMatches(authNotAuthenticatedUrls, requestURI)
    }

    function notAuthenticated (response) {
        response.json({
            message: 'Authentication Error: Not Authenticated',
            status: 401
        }, 401)
    }

    function proccessAndValidateToken (params, request, response) {
        var tknAppName = getTokenName(params, request)
        var token = readToken(request, tknAppName)

        if (!token) {
            throw new Error('Authentication Error: An authorization token was not found.')
        }

        if (!isAccessTokenAlive(token)) {
            tryToRefreshToken(params, request, response, token)
        }

        if (!isAuthorized(request, token.udata && token.udata.data)) {
            throw new Error('Authorization Error: You are not allowed to access this resource.')
        }

        request.userData = token.udata
    }

    function isAccessTokenAlive (token) {
        return token.exp && token.exp >= new Date().getTime()
    }

    function isRefreshTokenAlive (token) {
        return token.rtexp && token.rtexp >= new Date().getTime()
    }

    function getTokenName (params, request) {
        return params['tknAppName'] || request.headers['tknAppName'] || 'tkn'
    }

    function readToken (request, name) {
        var tkn = extractToken(request, name || 'tkn')

        if (tkn) {
            return JSON.parse(jwt.deserialize(tkn, true))
        }

        return null
    }

    function extractToken (request, name) {
        var cookies = request.cookies || {}
        var token = cookies[name]
        if (!token && cookies.length) {
            for (var i = 0; i < cookies.length; i++) {
                if (cookies[i].getName() === name) {
                    return cookies[i].getValue()
                }
            }
        }
        return token
    }

    function tryToRefreshToken (params, request, response, token) {
        if (!isRefreshTokenAlive(token)) {
            throw new Error('Authentication Error: RefreshToken is expired (' + new Date() + ')')
        }

        if (authCanRefreshTokenFn && !authCanRefreshTokenFn(token)) {
            throw new Error('Authentication Error: Access denied when trying to refresh token (' + new Date() + ')')
        }

        token.exp = new Date().getTime() + getAccessTokenTTL(token.udata.app)
        token.rtexp = new Date().getTime() + getRefreshTokenTTL(token.udata.app)

        setTokenIntoHeader(params, request, response, jwt.serialize(token, true))
    }

    function setTokenIntoHeader (params, request, response, serializedToken) {
        var tknAppName = getTokenName(params, request)

        var secure = (authUseSecureAuthentication ? 'secure;' : '')
        var expires = ';expires=' + new Date(new Date().getFullYear() + 5, 0, 1).toUTCString()

        var cookieStr = tknAppName + '=' + serializedToken + ';HttpOnly;path=/;' + secure + expires

        cookieStr = cookieStr.replace(/;([\w])/g, '; $1')

        response.addHeader('Set-Cookie', cookieStr)
    }

    function getRefreshTokenTTL (app) {
        return authRefreshTokenTTL[app] || authRefreshTokenTTL['default']
    }

    function getAccessTokenTTL (app) {
        return authAccessTokenTTL[app] || authAccessTokenTTL['default']
    }
}

var auth = new Auth()

exports = auth
