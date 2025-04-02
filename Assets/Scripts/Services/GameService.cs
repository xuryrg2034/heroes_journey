using Entities.Player;
using Grid;
using Services.Quest;
using Services.Turn;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Serialization;
using UnityEngine.Tilemaps;

namespace Services
{
    public class GameService : MonoBehaviour
    {
        [Header("Tilemaps")]
        [SerializeField] Tilemap groundTilemap;
        [SerializeField] Tilemap obstacleTilemap;

        [Header("Services")]
        [SerializeField] AbilitiesUIService abilitiesUIService;
        [SerializeField] GameObject questService;
        [SerializeField] HeroUIService heroUIService;
        [SerializeField] TurnService turnService;
        [SerializeField] Hero heroPrefab;

        Hero _hero;

        void Awake()
        {
            RegisterServices();
            GridInitialize();
            AbilitiesInitialize();
            QuestsInitialize();
            TurnServiceInitialize();
        }

        void RegisterServices()
        {
            var spawnService = new SpawnService();
            var uiStateService = new UiStateService();
            var levelStatistics = new LevelStatistics();
            var gridService = new GridService(groundTilemap, obstacleTilemap, spawnService);
            
            ServiceLocator.Register(spawnService);
            ServiceLocator.Register(uiStateService);
            ServiceLocator.Register(levelStatistics);
            ServiceLocator.Register(gridService);
        }

        void AbilitiesInitialize()
        {
            var abilitiesService = new AbilitiesService(_hero);
            ServiceLocator.Register(abilitiesService);
        }
        
        void QuestsInitialize()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }

        void GridInitialize()
        {
            var spawnService = ServiceLocator.Get<SpawnService>();
            var gridService = ServiceLocator.Get<GridService>();
            _hero = spawnService.SpawnHero(heroPrefab);
            
            gridService.SpawnEntitiesOnGrid();
            
            heroUIService.Init(_hero);
        }

        void TurnServiceInitialize()
        {
            turnService.Init();
        }
    }
}