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
        [SerializeField] private AbilitiesUIService abilitiesUIService;
        [SerializeField] private GameObject questService;
        [SerializeField] private UIService uiService;
        [SerializeField] private TurnService turnService;
        [SerializeField] private Hero heroPrefab;

        private Hero _heroEntity;
        
        public static UnityEvent<GameState> OnGameStateChange = new();
        public static GameState CurrentState { get; private set; } = GameState.WaitingForInput;

        // FIXME: Порядок вызова важен. Происходит регистрация классов в сервис локаторе
        void Awake()
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

        void _prepareAbilities()
        {
            ServiceLocator.Register(new AbilitiesService(_heroEntity));
        }
        
        void _prepareQuests()
        {
            var service = questService.GetComponent<QuestService>();
            var ui = questService.GetComponent<QuestUIService>();

            service.Init();
            ui.Init(service);
        }

        void _prepareGrid()
        {
            ServiceLocator.Register(gridService);

            gridService.Init();
            _heroEntity = (Hero)gridService.SpawnEntity(heroPrefab, heroPrefab.SpawnPosition);
            gridService.SpawnEntitiesOnGrid();
            
            uiService.Init(_heroEntity);
        }

        void _prepareTurnService()
        {
            turnService.Init();
        }

        void _prepareLevelStatistics()
        {
            ServiceLocator.Register(new LevelStatistics());
        }
    }
}