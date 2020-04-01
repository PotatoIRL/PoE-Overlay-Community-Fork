import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BrowserService, LoggerService, SessionService, StorageService } from '@app/service';
import { environment } from '@env/environment';
import { Observable, of, throwError } from 'rxjs';
import { catchError, delay, flatMap, retryWhen } from 'rxjs/operators';
import { CurrencyOverviewResponse } from '../schema/currency-overview';

export enum CurrencyOverviewType {
    Currency = 'Currency',
    Fragment = 'Fragment'
}

const PATH_TYPE_MAP = {
    [CurrencyOverviewType.Currency]: 'currency',
    [CurrencyOverviewType.Fragment]: 'fragments',
};

const RETRY_COUNT = 3;
const RETRY_DELAY = 100;

@Injectable({
    providedIn: 'root'
})
export class CurrencyOverviewHttpService {
    private readonly baseUrl: string;

    constructor(
        private readonly httpClient: HttpClient,
        private readonly browser: BrowserService,
        private readonly session: SessionService,
        private readonly storage: StorageService,
        private readonly logger: LoggerService) {
        this.baseUrl = `${environment.poeNinja.baseUrl}/api/data/currencyoverview`;
    }

    public get(leagueId: string, type: CurrencyOverviewType): Observable<CurrencyOverviewResponse> {
        const url = this.getUrl(leagueId, type);
        return this.httpClient.get(url, {
            observe: 'response',
            responseType: 'text'
        }).pipe(
            retryWhen(errors => errors.pipe(
                flatMap((response, count) => this.handleError(url, response, count))
            )),
            flatMap(httpResponse => {
                const response = <CurrencyOverviewResponse>JSON.parse(httpResponse.body);
                if (!response.lines) {
                    this.logger.warn(`Got empty result from '${url}'.`, response);
                    return throwError(`Got empty result from '${url}'.`);
                }

                const result: CurrencyOverviewResponse = {
                    lines: response.lines,
                    url: `${environment.poeNinja.baseUrl}/challenge/${PATH_TYPE_MAP[type]}`
                }
                return of(result);
            }),
            catchError(error => this.storage.get<CurrencyOverviewResponse>(url).pipe(
                flatMap(cachedResponse => {
                    if (cachedResponse) {
                        this.logger.warn(`Could not fetch response from: '${url}'. Using cached data for now...`, error);
                        return of(cachedResponse);
                    }
                    return throwError(error);
                })
            )),
            flatMap(response => this.storage.saveCopy(url, response))
        );
    }

    private handleError(url: string, response: HttpErrorResponse, count: number): Observable<void> {
        if (count >= RETRY_COUNT) {
            return throwError(response);
        }

        switch (response.status) {
            case 403:
                return this.browser.retrieve(url).pipe(delay(RETRY_DELAY));
            default:
                return this.session.clear().pipe(delay(RETRY_DELAY));
        }
    }

    private getUrl(leagueId: string, type: CurrencyOverviewType): string {
        return `${this.baseUrl}?league=${encodeURIComponent(leagueId)}&type=${encodeURIComponent(type)}&language=en`;
    }
}
