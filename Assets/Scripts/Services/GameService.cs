using Entities.Player;
using Grid;
using Services.Quest;
using Services.Turn;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Serialization;

namespace Services
{
    public enum GameState
    {
        TurnInProcess,
        PlayerTurn,
        EnemyTurn,
        WaitingForInput,
        UpdateGrid,
        Finish,
        QuestCheck,
    }
    
    public class GameService : MonoBehaviour
    {
        [SerializeField] private GridService gridService;
        [SerializeField] private GameObject abilitiesService;
        [SerializeField] private GameObject questService;
        [FormerlySerializedAs("heroUIService")] [SerializeField] private UIService uiService;
        [SerializeField] private TurnService turnService;
        [SerializeField] private Hero heroPrefab;
        [SerializeField] private Vector3Int heroPositionSpawn;
        

        private Hero _heroEntity;
        
        public static UnityEvent<GameState> OnGameStateChange = new();
        public static GameState CurrentState { get; private set; } = GameState.WaitingForInput;

        // FIXME: Порядок вызова важен. Происходит решистрация классов в сервис локаторе
        private void Start()
        {
            _prepareLevelStatistics();
            _prepareGrid();
            _prepareAbilities();
            _prepareQuests();
            _prepareTurnService();
        }

        public static void SetGameState(GameState state)
        {
            CurrentState = state;
            OnGameStateChange?.Invoke(CurrentState);
        }

        private void _prepareAbilities()
        {
            var service = abilitiesService.GetComponent<AbilitiesService>();
            var ui = abilitiesService.GetComponent<AbilitiesUIService>();
            
            ServiceLocator.Register(service);

            service.Init(_heroEntity.Abilities);
            ui.Init(service);
        }
        
        private void _prepareQuests()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }

        private void _prepareGrid()
        {
            ServiceLocator.Register(gridService);

            gridService.Init();
            gridService.SpawnEntity(heroPrefab, heroPositionSpawn);
            gridService.SpawnEntitiesOnGrid();
            
            _heroEntity = gridService.GetEntitiesOfType<Hero>()[0];
            uiService.Init(_heroEntity);
        }

        private void _prepareTurnService()
        {
            turnService.Init();
        }

        private void _prepareLevelStatistics()
        {
            ServiceLocator.Register(new LevelStatistics());
        }
    }
}