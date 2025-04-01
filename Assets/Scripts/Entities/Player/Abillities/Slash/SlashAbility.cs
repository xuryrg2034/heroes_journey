using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using UnityEngine;
namespace Entities.Player.Slash
{
    public class SlashAbility : BaseAbility
    {
        [SerializeField] int baseDamage;
        
        List<BaseEntity> _selectedTargets = new();

        List<Vector3> _directions = new()
        {
            new Vector3(1, 0, 0), // 0° - вправо
            new Vector3(1, 1, 0), // 45° - вверх-вправо
            new Vector3(0, 1, 0), // 90° - вверх
            new Vector3(-1, 1, 0), // 135° - вверх-влево
            new Vector3(-1, 0, 0), // 180° - влево
            new Vector3(-1, -1, 0), // 225° - вниз-влево
            new Vector3(0, -1, 0), // 270° - вниз
            new Vector3(1, -1, 0), // 315° - вниз-вправо
        };

        public Vector3Int OriginPosition => Owner.GridPosition; 
        public List<Vector3> Directions => _directions; 
        
        void Start()
        {
            SelectionState = new SlashSelectionState(this);
            ExecuteState = new SlashAttackState(this, Owner);
        }

        void Update()
        {
            CheckCanBeExecute();
        }
        
        public override async UniTask Execute()
        {
            IsInProcess = true;

            await base.Execute();
            
            StateMachine.SetNextState(ExecuteState);

            // Не уверен, что хороший план
            await UniTask.WaitUntil(() => StateMachine.CurrentState is AbilityIdleState);
            
            IsInProcess = false;
        }

        public void SelectEntity(BaseEntity entity)
        {
            _selectedTargets.Add(entity);
        }

        public void ResetSelection()
        {
            _selectedTargets.Clear();
        }

        public void Attack()
        {
            foreach (var target in _selectedTargets)
            {
                target.Health.TakeDamage(Owner.Damage.Value +  baseDamage).Forget();
            }
        }
        
        void CheckCanBeExecute()
        {
            CanBeExecute = _selectedTargets.Count > 0;
        }
    }
}
