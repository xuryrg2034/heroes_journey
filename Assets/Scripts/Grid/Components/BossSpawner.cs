using Configs.Entities.Enemies;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using Services;
using Services.EventBus;
using UnityEngine;

namespace Grid.Components
{
    public class BossSpawner : MonoBehaviour
    {
        [SerializeField] UnityEngine.Grid grid;
        
        [SerializeField] Enemy bossPrefab;
        
        [SerializeField] BossConfig bossConfig;

        Vector3Int _gridPosition;
        
        SpawnService _spawnService;
        
        GridService _gridService;
        
        
        void OnDrawGizmos()
        {
            Gizmos.color = Color.red;
            Gizmos.DrawWireCube(transform.position, Vector3.one); // размер клетки 1x1
        }

        void OnEnable()
        {
            EventBusService.Subscribe(Actions.AllQuestCompleted, Spawn);
        }

        void OnDisable()
        {
            EventBusService.Unsubscribe(Actions.AllQuestCompleted, Spawn);
        }

        void Start()
        {
            _spawnService = ServiceLocator.Get<SpawnService>();
            _gridService = ServiceLocator.Get<GridService>();
            _gridPosition = grid.WorldToCell(transform.position);
        }

        void Spawn()
        {
            var boss = _spawnService.SpawnEnemy(bossPrefab, bossConfig);
            var entityOnGrid = _gridService.GetEntityAt(_gridPosition);

            if (entityOnGrid)
            {
                _spawnService.DisposeEntity(entityOnGrid);
            }
            
            boss.Move(_gridPosition, 0).Forget();
            boss.Health.OnDie.AddListener(() =>
            {
                EventBusService.Trigger(Actions.BossDied);
            });
        }
    }
}